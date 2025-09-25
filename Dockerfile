# ============================================
# Build stage - Node.js setup
# ============================================
FROM node:20-alpine as builder

# Install build dependencies
RUN apk add --no-cache \
    python3=~3.11 \
    python3-dev=~3.11 \
    py3-pip \
    make \
    g++ \
    gcc \
    linux-headers \
    udev \
    eudev-dev \
    libusb-dev \
    wget \
    && rm -rf /var/cache/apk/*

# Create Python virtual environment
RUN python3 -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

# Fix pip installation and upgrade
RUN wget https://bootstrap.pypa.io/get-pip.py && \
    python3 get-pip.py && \
    rm get-pip.py && \
    pip3 install --no-cache-dir --upgrade pip setuptools wheel

# Set working directory
WORKDIR /app

# First copy only package files for better layer caching
COPY --chown=node:node package.json package-lock.json ./

# Install production dependencies
RUN npm ci --only=production --no-audit --no-fund --unsafe-perm

# Copy the rest of the application code
COPY --chown=node:node . .

# Ensure models directory exists with correct permissions
RUN mkdir -p /app/models && \
    chown -R node:node /app/models

# Handle model files - copy from root to models directory if they exist in root
RUN if [ -f "/app/kokoro-v1.0.onnx" ] && [ -f "/app/voices-v1.0.bin" ]; then \
        echo "Copying model files from root to /app/models/" && \
        cp /app/kokoro-v1.0.onnx /app/models/ && \
        cp /app/voices-v1.0.bin /app/models/ && \
        chown -R node:node /app/models; \
    elif [ -f "/app/models/kokoro-v1.0.onnx" ] && [ -f "/app/models/voices-v1.0.bin" ]; then \
        echo "Model files already in /app/models/"; \
    else \
        echo "WARNING: Model files not found in expected locations"; \
    fi

# Install TypeScript globally for building
RUN npm install -g typescript

# Install dev dependencies and build
RUN npm ci --include=dev && \
    npm run build

# Create necessary directories
RUN mkdir -p dist/server

# Show current directory structure for debugging
RUN echo "=== Current directory structure ===" && ls -la /app/

# Create server directory structure
RUN mkdir -p /app/server/python-tts

# Copy Python TTS files directly to the target directory
COPY --chown=node:node server/python-tts/ /app/server/python-tts/

# Install Python dependencies for TTS server
COPY server/python-tts/requirements.txt /tmp/
RUN pip3 install --no-cache-dir -r /tmp/requirements.txt && \
    pip3 install --no-cache-dir \
    kokoro-tts==2.3.0 \
    fastapi \
    uvicorn[standard] \
    websockets \
    python-multipart \
    "numpy<2.0.0" \
    "scipy<2.0.0" \
    soundfile \
    "onnxruntime>=1.8.0,<1.9.0"

# Ensure model files are downloaded and in the correct location
RUN mkdir -p /app/models && \
    wget -q https://github.com/nazdridoy/kokoro-tts/releases/download/v1.0.0/voices-v1.0.bin -O /app/models/voices-v1.0.bin && \
    wget -q https://github.com/nazdridoy/kokoro-tts/releases/download/v1.0.0/kokoro-v1.0.onnx -O /app/models/kokoro-v1.0.onnx && \
    chown -R node:node /app/models

# Set correct permissions
RUN chown -R node:node /app/server/python-tts && \
    chmod +x /app/server/python-tts/kokoro_server.py

# Install system dependencies for Python and TTS
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3-pip \
    python3-venv \
    python3-dev \
    build-essential \
    libsndfile1 \
    libsndfile1-dev \
    libopenblas-dev \
    libatlas-base-dev \
    gfortran \
    && rm -rf /var/lib/apt/lists/*

# Create and activate Python virtual environment
RUN python3 -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

# Upgrade pip and setuptools
RUN pip install --no-cache-dir --upgrade pip setuptools wheel

# Install Python dependencies
COPY --chown=node:node server/python-tts/requirements.txt /tmp/requirements.txt
RUN pip install --no-cache-dir -r /tmp/requirements.txt && \
    rm /tmp/requirements.txt

# Install kokoro-tts package with specific version for compatibility
RUN pip install --no-cache-dir kokoro-tts

# Install additional required packages for the TTS service
RUN pip install --no-cache-dir \
    fastapi \
    uvicorn \
    python-multipart \
    numpy \
    scipy \
    soundfile \
    onnxruntime

# Verify Python installation
RUN python3 --version && \
    pip --version && \
    pip list | grep -E 'kokoro|fastapi|uvicorn|onnxruntime'

# Create server package.json for ES modules
RUN echo '{"type": "module"}' > ./dist/server/package.json

# Copy and build TypeScript files for server
COPY tsconfig.server.json ./
RUN npx tsc --project tsconfig.server.json

# Verify the build
RUN ls -la dist/server/

# Verify the build
RUN ls -la dist/server/

# ============================================
# Production stage
# ============================================
FROM python:3.11-slim as runtime

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    netcat-openbsd \
    libudev-dev \
    pkg-config \
    libusb-1.0-0-dev \
    portaudio19-dev \
    libasound2-dev \
    libsndfile1-dev \
    ffmpeg \
    libportaudio2 \
    python3-pyaudio \
    python3-dev \
    espeak \
    libespeak1 \
    libespeak-ng1 \
    espeak-ng \
    libespeak-ng-dev \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Install Node.js 20 and create node user
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs \
    && groupadd -r node && useradd -r -g node node \
    && mkdir -p /home/node \
    && chown -R node:node /home/node \
    && rm -rf /var/lib/apt/lists/*

# Create and activate virtual environment with proper permissions
ENV VIRTUAL_ENV=/opt/venv
RUN python -m venv $VIRTUAL_ENV \
    && chown -R node:node $VIRTUAL_ENV \
    && chmod -R 755 $VIRTUAL_ENV
ENV PATH="$VIRTUAL_ENV/bin:$PATH"

# Install uv (recommended installer)
RUN pip install --no-cache-dir uv

# Install Python dependencies in a single layer to minimize image size
COPY server/python-ws/requirements.txt .
RUN python -m pip install --upgrade pip && \
    pip install --no-cache-dir \
        kokoro-tts==2.3.0 \
        fastapi \
        uvicorn[standard] \
        websockets \
        python-multipart \
        "numpy<2.0.0" \
        "scipy<2.0.0" \
        soundfile \
        "onnxruntime>=1.8.0,<1.9.0" && \
    # Create a directory for model files
    mkdir -p /app/models && \
    # Download the model files
    wget -q https://github.com/nazdridoy/kokoro-tts/releases/download/v1.0.0/voices-v1.0.bin -O /app/models/voices-v1.0.bin && \
    wget -q https://github.com/nazdridoy/kokoro-tts/releases/download/v1.0.0/kokoro-v1.0.onnx -O /app/models/kokoro-v1.0.onnx && \
    # Create symlink for the executable
    ln -s /opt/venv/bin/kokoro-tts /usr/local/bin/kokoro-tts && \
    # Verify installation
    python -c "import kokoro_tts; print('kokoro-tts imported successfully')" && \
    # Verify the executable is in PATH and show help
    which kokoro-tts && \
    kokoro-tts --help && \
    # Clean up
    rm -f requirements.txt

# Set up application directory
WORKDIR /app

# Copy built files from builder
COPY --chown=node:node --from=builder /app/node_modules ./node_modules
COPY --chown=node:node --from=builder /app/dist ./dist
COPY --chown=node:node --from=builder /app/package*.json ./
COPY --chown=node:node --from=builder /app/public ./public

# Ensure the server directory exists in the final image
RUN mkdir -p /app/dist/server

# Install production dependencies
RUN npm ci --only=production --no-audit --no-fund --unsafe-perm

# Create necessary directories with correct ownership
RUN mkdir -p /app/public/uploads \
    && mkdir -p /app/models \
    && chown -R node:node /app \
    && chmod -R 755 /app/models

# Set environment variables
ENV NODE_ENV=production \
    PORT=8787 \
    PYTHONPATH=/app/server/python-ws \
    PATH="/opt/venv/bin:/app/node_modules/.bin:$PATH" \
    PYTHONUNBUFFERED=1 \
    VIRTUAL_ENV=/opt/venv \
    KOKORO_MODEL_PATH=/app/models/kokoro-v1.0.onnx \
    KOKORO_VOICES_PATH=/app/models/voices-v1.0.bin \
    KOKORO_TTS_BIN="/opt/venv/bin/kokoro-tts"

# Verify kokoro-tts installation
RUN echo "=== Verifying kokoro-tts installation ===" && \
    # Check if executable exists and is in PATH
    which kokoro-tts && \
    # Show executable details
    ls -la $(which kokoro-tts) && \
    # Verify basic functionality with --help
    kokoro-tts --help && \
    # Check Python module import and version
    python -c "\
import kokoro_tts; \
print('kokoro-tts module path:', kokoro_tts.__file__); \
print('kokoro-tts version:', getattr(kokoro_tts, '__version__', 'unknown')); \
print('Model path:', getattr(kokoro_tts, 'DEFAULT_MODEL_PATH', 'Not set')); \
print('Voices path:', getattr(kokoro_tts, 'DEFAULT_VOICES_PATH', 'Not set'))" && \
    # Verify model files exist
    echo "=== Checking model files ===" && \
    ls -la /app/models/ && \
    [ -f "$KOKORO_MODEL_PATH" ] && echo "Model file found: $KOKORO_MODEL_PATH" || echo "Error: Model file not found" && \
    [ -f "$KOKORO_VOICES_PATH" ] && echo "Voices file found: $KOKORO_VOICES_PATH" || echo "Error: Voices file not found"

# Expose ports
EXPOSE 3000 8787 8899

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD nc -z localhost 3000 && nc -z localhost 8787 && nc -z localhost 8899 || exit 1

# Install bash if not present
RUN apt-get update && apt-get install -y --no-install-recommends bash && \
    rm -rf /var/lib/apt/lists/*

# Copy and set up startup script
COPY --chown=node:node start-services.sh /app/start-services.sh
RUN chmod +x /app/start-services.sh && \
    # Ensure node user has access to the virtual environment
    chown -R node:node /opt/venv && \
    chmod -R 755 /opt/venv && \
    # Ensure bash is used for the script
    sed -i 's|^#!/bin/sh|#!/bin/bash|' /app/start-services.sh

# Run as non-root user
USER node

# Start the application using bash to ensure proper shell features
CMD ["bash", "/app/start-services.sh"]