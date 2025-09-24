# ============================================
# Build stage - Node.js setup
# ============================================
FROM node:20-alpine as node-builder

# Install build dependencies
RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    gcc \
    git \
    && rm -rf /var/cache/apk/*

# Set working directory
WORKDIR /app

# Copy package files first for better layer caching
COPY package.json package-lock.json ./
COPY tsconfig*.json ./

# Install dependencies
RUN npm ci --no-audit --no-fund --unsafe-perm

# Copy application code
COPY . .

# Build the application
RUN npm run build

# ============================================
# Python environment stage
# ============================================
FROM python:3.11-slim as python-base

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libsndfile1-dev \
    portaudio19-dev \
    python3-dev \
    espeak \
    libespeak-ng1 \
    && rm -rf /var/lib/apt/lists/*

# Create virtual environment
ENV VIRTUAL_ENV=/opt/venv
RUN python -m venv $VIRTUAL_ENV
ENV PATH="$VIRTUAL_ENV/bin:$PATH"

# Install Python dependencies
COPY server/python-tts/requirements.txt .
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir -r requirements.txt && \
    pip install --no-cache-dir kokoro-tts numpy sounddevice pydantic uvicorn[standard] && \
    rm requirements.txt

# ============================================
# Final production stage
# ============================================
FROM python:3.11-slim

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    libsndfile1 \
    portaudio19-dev \
    espeak \
    libespeak-ng1 \
    ffmpeg \
    curl \
    netcat-openbsd \
    && rm -rf /var/lib/apt/lists/*

# Install Node.js 20
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

# Create non-root user
RUN groupadd -r node && useradd -r -g node node \
    && mkdir -p /home/node/app \
    && chown -R node:node /home/node

# Copy Python virtual environment
COPY --from=python-base /opt/venv /opt/venv
ENV VIRTUAL_ENV=/opt/venv
ENV PATH="$VIRTUAL_ENV/bin:$PATH"

# Set up application directory
WORKDIR /app

# Copy built files from node-builder
COPY --from=node-builder --chown=node:node /app/node_modules ./node_modules
COPY --from=node-builder --chown=node:node /app/dist ./dist
COPY --from=node-builder --chown=node:node /app/package*.json ./
COPY --from=node-builder --chown=node:node /app/public ./public

# Create necessary directories
RUN mkdir -p /app/models \
    && chown -R node:node /app \
    && chmod -R 755 /app/models

# Download model files
RUN curl -L -o /app/models/voices-v1.0.bin \
    https://github.com/nazdridoy/kokoro-tts/releases/download/v1.0.0/voices-v1.0.bin \
    && curl -L -o /app/models/kokoro-v1.0.onnx \
    https://github.com/nazdridoy/kokoro-tts/releases/download/v1.0.0/kokoro-v1.0.onnx \
    && chown -R node:node /app/models \
    && chmod -R 644 /app/models/*

# Set environment variables
ENV NODE_ENV=production \
    PORT=8787 \
    PYTHONPATH="/app/server:/app" \
    PYTHONUNBUFFERED=1 \
    KOKORO_MODEL_PATH=/app/models/kokoro-v1.0.onnx \
    KOKORO_VOICES_PATH=/app/models/voices-v1.0.bin \
    KOKORO_SERVER_HOST=0.0.0.0 \
    KOKORO_SERVER_PORT=8899 \
    KOKORO_API_PORT=8900 \
    KOKORO_MAX_TEXT_LENGTH=500 \
    KOKORO_STARTUP_TIMEOUT=30

# Expose ports
EXPOSE 3000 8787 8899 8900

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD nc -z localhost 3000 && nc -z localhost 8787 && nc -z localhost 8899 || exit 1

# Copy and set up startup script
COPY --chown=node:node start-services.sh /app/start-services.sh
RUN chmod +x /app/start-services.sh && \
    # Ensure node user has access to the virtual environment
    chown -R node:node /opt/venv && \
    chmod -R 755 /opt/venv && \
    # Ensure bash is used for the script
    apt-get update && apt-get install -y --no-install-recommends bash && \
    rm -rf /var/lib/apt/lists/* && \
    sed -i 's|^#!/bin/sh|#!/bin/bash|' /app/start-services.sh

# Verify installations
RUN echo "=== Verifying installations ===" && \
    # Verify Python and pip
    python --version && \
    pip --version && \
    # Verify Node.js and npm
    node --version && \
    npm --version && \
    # Verify kokoro-tts installation
    python -c "import kokoro_tts; print(f'kokoro-tts: {kokoro_tts.__file__}')" && \
    # Verify model files
    echo "=== Model files ===" && \
    ls -la /app/models/ && \
    [ -f "$KOKORO_MODEL_PATH" ] && echo "Model file found" || echo "Error: Model file not found" && \
    [ -f "$KOKORO_VOICES_PATH" ] && echo "Voices file found" || echo "Error: Voices file not found"

# Run as non-root user
USER node

# Set the entrypoint
ENTRYPOINT ["/app/start-services.sh"]
CMD ["bash", "/app/start-services.sh"]