# ============================================
# Frontend build stage
# ============================================
FROM node:20-slim as frontend-builder

WORKDIR /app

# Install only the dependencies needed for building
COPY package*.json ./
RUN npm ci

# Copy ALL frontend source files including index.html
COPY . .

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
    wget \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Create virtual environment and set environment variables
ENV VIRTUAL_ENV=/opt/venv \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1
RUN python -m venv $VIRTUAL_ENV
ENV PATH="$VIRTUAL_ENV/bin:$PATH"

# Install dependencies
COPY server/python-tts/requirements.txt /tmp/requirements.txt
RUN pip install --no-cache-dir -U pip setuptools wheel && \
    pip install --no-cache-dir numpy>=2.0.2 && \
    pip install --no-cache-dir -r /tmp/requirements.txt

# Verify Kokoro installation
RUN python3 -c "from kokoro_onnx import Kokoro; from kokoro_onnx.tokenizer import Tokenizer; print('Kokoro packages available')"

# Download model files (with retry and verification)
RUN mkdir -p /app/models && \
    for i in $(seq 1 3); do \
        if wget -q https://github.com/nazdridoy/kokoro-tts/releases/download/v1.0.0/voices-v1.0.bin -O /app/models/voices-v1.0.bin && \
        wget -q https://github.com/nazdridoy/kokoro-tts/releases/download/v1.0.0/kokoro-v1.0.onnx -O /app/models/kokoro-v1.0.onnx && \
        [ -s /app/models/voices-v1.0.bin ] && [ -s /app/models/kokoro-v1.0.onnx ]; then \
            echo "Model files downloaded successfully"; \
            break; \
        else \
            echo "Attempt $i failed, retrying..."; \
            sleep 5; \
        fi; \
        if [ $i -eq 3 ]; then exit 1; fi; \
    done

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
    procps && \
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && \
    apt-get install -y nodejs && \
    rm -rf /var/lib/apt/lists/*

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

# Create non-root user (using system UID range)
RUN useradd -r -u 999 -g root appuser && \
    chown -R appuser:root /app && \
    chmod -R g=u /app
USER appuser

EXPOSE 3000 8787 8899

HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
    CMD nc -z localhost 3000 && nc -z localhost 8787 && nc -z localhost 8899

CMD ["./start-services.sh"]

# Copy Python TTS files with clear logging
RUN echo "=== Copying Python TTS files ===" && \
    ls -la /app/server/python-tts/ || true && \
    mkdir -p /app/server/python-tts && \
    echo "Directory created: /app/server/python-tts"

COPY server/python-tts/*.py /app/server/python-tts/
RUN echo "=== Python TTS files copied ===" && \
    ls -la /app/server/python-tts/