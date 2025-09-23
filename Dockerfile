# Force complete rebuild - change this value to invalidate all caches
ARG CACHE_BUSTER=2025-09-23-05-35

# ============================================
# Node.js build stage - For frontend build
# ============================================
FROM node:20-alpine as node-builder

# Set working directory
WORKDIR /app

# Install build dependencies
RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    gcc \
    linux-headers \
    eudev-dev \
    libusb-dev \
    udev \
    && rm -rf /var/cache/apk/*

# Install Node.js dependencies with cache busting
COPY package.json package-lock.json ./
RUN echo "Cache buster: $CACHE_BUSTER" && \
    npm ci --no-audit --no-fund --unsafe-perm && \
    npm install -g tsx && \
    npm install --save-dev tsx && \
    npm list -g tsx && \
    echo "tsx version: $(tsx --version)"

# Copy application code
COPY . .

# Build the application
RUN npm run build && \
    mkdir -p dist && \
    if [ -d "build" ]; then cp -r build/* dist/; fi && \
    if [ -d "dist/client" ]; then cp -r dist/client/* dist/ && rm -rf dist/client; fi && \
    chmod -R 755 dist

# ============================================
# Python base stage - For Python dependencies
# ============================================
FROM python:3.11-slim as python-base

# Set environment variables
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

# Install build and system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    python3-pip \
    python3-dev \
    curl \
    gcc \
    g++ \
    make \
    cmake \
    wget \
    git \
    # Audio processing
    libsndfile1 \
    libportaudio2 \
    libasound2 \
    libsndfile1-dev \
    portaudio19-dev \
    libasound2-dev \
    libpulse-dev \
    libavcodec-dev \
    libavformat-dev \
    libswscale-dev \
    libx264-dev \
    # Text-to-speech dependencies
    espeak \
    ffmpeg \
    flac \
    # Other dependencies
    libffi-dev \
    libssl-dev \
    zlib1g-dev \
    libbz2-dev \
    libreadline-dev \
    libsqlite3-dev \
    llvm \
    libncurses5-dev \
    libncursesw5-dev \
    xz-utils \
    tk-dev \
    liblzma-dev \
    && rm -rf /var/lib/apt/lists/* \
    && apt-get clean

# Create and activate virtual environment
RUN python3 -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

# Install Python dependencies
WORKDIR /app
COPY server/python-ws/requirements.txt .

# Install PyTorch first with retry logic
RUN pip install --upgrade pip && \
    pip install --no-cache-dir -r requirements.txt && \
    { \
        for i in {1..5}; do \
            if pip install --no-cache-dir torch==2.0.1+cpu torchaudio==2.0.2 --index-url https://download.pytorch.org/whl/cpu; then \
                echo "PyTorch installed successfully"; \
                break; \
            else \
                echo "PyTorch installation attempt $i failed, retrying..."; \
                sleep 10; \
            fi; \
            if [ $i -eq 5 ]; then \
                echo "Failed to install PyTorch after 5 attempts"; \
                exit 1; \
            fi; \
        done \
    } && \
    pip install --no-cache-dir uvicorn[standard]

# Create model directory
RUN mkdir -p /app/server/python-tts && \
    chmod -R 777 /app/server/python-tts

# ============================================
# Final stage - Production runtime
# ============================================
FROM node:20-alpine

# Install runtime dependencies
RUN apk add --no-cache \
    # Python runtime
    python3 \
    py3-pip \
    # Audio processing
    libsndfile \
    portaudio \
    alsa-lib \
    alsa-utils \
    pulseaudio \
    sox \
    ffmpeg \
    # Text-to-speech
    espeak \
    # System utilities
    netcat-openbsd \
    curl \
    bash \
    # Clean up
    && rm -rf /var/cache/apk/* \
    # Install Node.js tools
    && npm install -g tsx concurrently \
    && echo "tsx version: $(tsx --version)"

# Create app directory structure
WORKDIR /app
RUN mkdir -p /app/dist /app/server /app/public/uploads && \
    chmod -R 777 /app/server

# Copy Python virtual environment from build stage
COPY --from=python-base /opt/venv /opt/venv

# Set up the virtual environment
ENV VIRTUAL_ENV="/opt/venv"
ENV PATH="$VIRTUAL_ENV/bin:$PATH"

# Create a wrapper script to activate the virtual environment
RUN echo '#!/bin/sh\n. "$VIRTUAL_ENV/bin/activate"\nexec "$@"' > /usr/local/bin/venv && \
    chmod +x /usr/local/bin/venv

# Verify Python and pip versions
RUN python3 --version && \
    pip --version && \
    which python3 && \
    which pip && \
    pip list

# Install Python dependencies using the virtual environment
COPY server/python-ws/requirements.txt /tmp/requirements.txt
RUN venv pip install --no-cache-dir --upgrade pip && \
    venv pip install --no-cache-dir -r /tmp/requirements.txt && \
    venv pip install --no-cache-dir uvicorn[standard] && \
    rm /tmp/requirements.txt

# Copy server code
COPY server ./server

# Copy built application and node modules from node-builder
COPY --from=node-builder /app/dist ./dist
COPY --from=node-builder /app/public ./public
COPY --from=node-builder /app/package*.json ./
COPY --from=node-builder /app/node_modules ./node_modules

# Copy application code
COPY . .

# Set environment variables
ENV NODE_ENV=production \
    PORT=8787 \
    PATH="/app/node_modules/.bin:$PATH" \
    NODE_PATH=/app/node_modules \
    PYTHONUNBUFFERED=1

# Install Node.js tools
RUN npm install -g tsx concurrently && \
    echo "tsx version: $(tsx --version)"

# Expose necessary ports
EXPOSE 3000 8787 8899

# Set health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
    CMD (nc -z localhost 3000 || exit 1) && \
        (nc -z localhost 8787 || exit 1) && \
        (nc -z localhost 8899 || exit 1) || exit 1

# Make startup script executable and set it as entrypoint
RUN chmod +x /app/start-services.sh

# Debug: Show installed Python packages
RUN pip freeze
WORKDIR /app

# Start all services
CMD ["/bin/sh", "/app/start-services.sh"]