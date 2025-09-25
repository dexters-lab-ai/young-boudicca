# ============================================
# Frontend build stage
# ============================================
FROM node:20-slim as frontend-builder

WORKDIR /app

# Install only the dependencies needed for building
COPY package*.json ./
RUN npm ci

# Copy frontend source files
COPY tsconfig*.json ./
COPY vite.config.ts ./
COPY src/ ./src/
COPY public/ ./public/

# Build frontend
RUN npm run build

# ============================================
# Python dependencies stage
# ============================================
FROM python:3.11.7-slim as python-builder

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    python3-dev \
    python3-pip \
    python3-venv \
    python3-wheel \
    libsndfile1 \
    libportaudio2 \
    portaudio19-dev \
    espeak-ng \
    libespeak-ng-dev \
    libffi-dev \
    && rm -rf /var/lib/apt/lists/*

# Create virtual environment
ENV VIRTUAL_ENV=/opt/venv
RUN python -m venv $VIRTUAL_ENV
ENV PATH="$VIRTUAL_ENV/bin:$PATH"

# Copy requirements first
COPY server/python-tts/requirements.txt /tmp/requirements.txt

# Install dependencies in the correct order
RUN pip install --no-cache-dir -U pip setuptools wheel && \
    pip install --no-cache-dir "numpy>=2.0.2" && \
    pip install --no-cache-dir -r /tmp/requirements.txt

# Verify installation by trying to list voices instead of checking version
RUN python3 -c "from kokoro_tts import list_voices; print('Kokoro TTS available')"

# Download model files
RUN mkdir -p /app/models && \
    wget -q https://github.com/nazdridoy/kokoro-tts/releases/download/v1.0.0/voices-v1.0.bin -O /app/models/voices-v1.0.bin && \
    wget -q https://github.com/nazdridoy/kokoro-tts/releases/download/v1.0.0/kokoro-v1.0.onnx -O /app/models/kokoro-v1.0.onnx

# ============================================
# Backend build stage
# ============================================
FROM node:20-slim as backend-builder

WORKDIR /app

# Copy package files
COPY package*.json ./
RUN npm ci

# Copy backend source
COPY server/ ./server/
COPY tsconfig.server.json ./

# Build backend
RUN npm run build:server

# ============================================
# Production stage
# ============================================
FROM python:3.11.7-slim as runtime

# Install Node.js and other dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    gnupg \
    netcat-openbsd \
    libsndfile1 \
    && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

# Copy Python environment
COPY --from=python-builder /opt/venv /opt/venv
COPY --from=python-builder /app/models /app/models
ENV PATH="/opt/venv/bin:$PATH"

# Copy built frontend
COPY --from=frontend-builder /app/dist /app/dist

# Copy built backend
COPY --from=backend-builder /app/dist/server /app/dist/server
COPY --from=backend-builder /app/server/python-tts /app/server/python-tts
COPY --from=backend-builder /app/package*.json /app/

# Copy startup script
COPY start-services.sh /app/
RUN chmod +x /app/start-services.sh

WORKDIR /app

# Install production node_modules
RUN npm ci --only=production

# Set environment variables
ENV NODE_ENV=production \
    PORT=8787 \
    KOKORO_MODEL_PATH=/app/models/kokoro-v1.0.onnx \
    KOKORO_VOICES_PATH=/app/models/voices-v1.0.bin

# Create non-root user
RUN useradd -r -u 1001 -g root appuser
RUN chown -R appuser:root /app && \
    chmod -R g=u /app
USER appuser

EXPOSE 3000 8787 8899

HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
    CMD nc -z localhost 3000 && nc -z localhost 8787 && nc -z localhost 8899

CMD ["./start-services.sh"]