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

# Create directories
RUN mkdir -p /app/server/python-tts

# Copy Python TTS server files
COPY server/python-tts/*.py /app/server/python-tts/

# Verify files were copied
RUN echo "=== Python TTS files ===" && \
    ls -la /app/server/python-tts/

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
RUN npm ci

# Copy backend source
COPY server/ ./server/
COPY tsconfig.server.json ./

# Build backend
RUN npm run build:server

# ============================================
# Runtime stage
# ============================================
FROM python:3.11.7-slim as runtime

# Install system dependencies and create app user
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    gnupg \
    netcat-openbsd \
    libsndfile1 \
    procps && \
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && \
    apt-get install -y nodejs && \
    groupadd -r appuser && \
    useradd -r -g appuser appuser && \
    mkdir -p /app && \
    chown -R appuser:appuser /app && \
    rm -rf /var/lib/apt/lists/*

# Copy Python environment
COPY --from=python-builder /opt/venv /opt/venv
COPY --from=python-builder /app/models /app/models
ENV PATH="/opt/venv/bin:$PATH"
ENV PYTHONUNBUFFERED=1
ENV PYTHONPATH="/app:/app/server/python-tts:$PYTHONPATH"

# Create necessary directories
RUN mkdir -p /app/dist /app/server /app/models /app/public

# Copy built frontend files - ensure they go to /app/dist
COPY --from=frontend-builder /app/dist /app/dist

# Copy built backend
COPY --from=backend-builder /app/dist/server /app/dist/server

# Copy application code
COPY --from=backend-builder /app/package*.json /app/
COPY --from=python-builder /app/models/* /app/models/
COPY --from=python-builder /app/server/python-tts /app/server/python-tts

# Create a symlink from /dist to /app/dist for backward compatibility
RUN ln -sf /app/dist /dist

# Verify the directory structure
RUN echo "=== Directory Structure ===" && \
    echo "/app/" && ls -la /app/ && \
    echo "/app/dist/" && ls -la /app/dist/ && \
    echo "/app/server/" && ls -la /app/server/

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

# Verify files
RUN echo "=== Verifying files ===" && \
    echo "Python files:" && \
    ls -la /app/server/python-tts/ && \
    echo "Model files:" && \
    ls -la /app/models/

# Set permissions
RUN chown -R appuser:root /app && \
    chmod -R g=u /app

# Verify files after copy
RUN test -f /app/server/python-tts/kokoro_server.py || (echo "ERROR: kokoro_server.py not found!" && exit 1)

USER appuser

EXPOSE 3000 8787 8899

HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
    CMD nc -z localhost 3000 && nc -z localhost 8787 && nc -z localhost 8899

CMD ["./start-services.sh"]