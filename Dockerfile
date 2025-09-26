# ============================================
# Frontend build stage
# ============================================
FROM node:20-slim as frontend-builder

WORKDIR /app

# Install dependencies with npm install for better compatibility
COPY package*.json ./
RUN npm install --legacy-peer-deps

# Copy ALL frontend source files including index.html
COPY . .

# Build frontend
RUN npm run build

# ============================================
# Python dependencies stage
# ============================================
FROM python:3.11.7-slim-bookworm as python-builder

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3-pip \
    python3-venv \
    libsndfile1 \
    portaudio19-dev \
    espeak-ng \
    wget \
    && rm -rf /var/lib/apt/lists/*

# Create virtual environment
ENV VIRTUAL_ENV=/opt/venv
RUN python -m venv $VIRTUAL_ENV
ENV PATH="$VIRTUAL_ENV/bin:$PATH"

# Install Kokoro TTS using the recommended method
RUN pip install --no-cache-dir -U pip && \
    pip install --no-cache-dir kokoro-tts

# Ensure python source is available in the python-builder image so runtime can copy from it
COPY server/python-tts /app/server/python-tts

# Create and populate models directory
RUN mkdir -p /app/models && \
    cd /app/models && \
    echo "Downloading model files..." && \
    for i in $(seq 1 3); do \
        if wget -q https://github.com/nazdridoy/kokoro-tts/releases/download/v1.0.0/voices-v1.0.bin && \
           wget -q https://github.com/nazdridoy/kokoro-tts/releases/download/v1.0.0/kokoro-v1.0.onnx && \
           [ -s voices-v1.0.bin ] && [ -s kokoro-v1.0.onnx ]; then \
            echo "Model files downloaded successfully"; \
            break; \
        else \
            echo "Attempt $i failed, retrying..."; \
            sleep 5; \
        fi; \
        if [ $i -eq 3 ]; then exit 1; fi; \
    done

# Verify Kokoro installation with downloaded models
RUN python3 -c "from kokoro_onnx import Kokoro; from kokoro_onnx.tokenizer import Tokenizer; print('Kokoro packages available')"

# ============================================
# Backend build stage
# ============================================
FROM node:20-slim as backend-builder

WORKDIR /app

# Copy package files
COPY package*.json ./
RUN npm install --legacy-peer-deps

# Copy backend source
COPY server/ ./server/
COPY tsconfig.server.json ./

# Build backend
RUN npm run build:server

# ============================================
# Production stage
# ============================================
FROM python:3.11.7-slim-bookworm as runtime

# Install runtime dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    libsndfile1 \
    libportaudio2 \
    portaudio19-dev \
    espeak-ng \
    libespeak-ng-dev \
    libffi-dev \
    llvm-runtime \
    && rm -rf /var/lib/apt/lists/*

# Copy the virtual environment from the builder stage
COPY --from=python-builder /opt/venv /opt/venv

# Set the PATH to use the virtual environment
ENV PATH="/opt/venv/bin:$PATH"

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

# Replace copy-from-backend/context with copy-from-python-builder to guarantee python sources are present
COPY --from=python-builder /app/server/python-tts /app/server/python-tts

COPY --from=backend-builder /app/package*.json /app/

# Copy startup script
COPY start-services.sh /app/
RUN chmod +x /app/start-services.sh

WORKDIR /app

# Install production node_modules
RUN npm install --only=production --legacy-peer-deps

# Set environment variables
ENV NODE_ENV=production \
    PORT=8787 \
    KOKORO_MODEL_PATH=/app/models/kokoro-v1.0.onnx \
    KOKORO_VOICES_PATH=/app/models/voices-v1.0.bin

# Verify files
RUN echo "=== Verifying files ===" && \
    echo "Python files:" && \
    ls -la /app/server/python-tts/ && \
    echo "Model files:" && \
    ls -la /app/models/

# Create non-root user (using system UID range)
RUN useradd -r -u 999 -g root appuser && \
    chown -R appuser:root /app && \
    chmod -R g=u /app

# Verify files after copy
RUN ls -la /app/server/python-tts/ && \
    test -f /app/server/python-tts/kokoro_server.py || (echo "ERROR: kokoro_server.py not found!" && exit 1)

USER appuser

EXPOSE 3000 8787 8899

HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
    CMD nc -z localhost 3000 && nc -z localhost 8787 && nc -z localhost 8899

CMD ["./start-services.sh"]