# ============================================
# Build stage - Node.js setup
# ============================================
FROM node:20-alpine as builder

# Install build dependencies
RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    gcc \
    linux-headers \
    udev \
    eudev-dev \
    libusb-dev \
    && rm -rf /var/cache/apk/*

# Set working directory and permissions
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund --unsafe-perm

# Copy application code
COPY . .

# Install TypeScript and build dependencies
RUN npm install -g typescript

# Install dependencies first
RUN npm ci

# Build the application
RUN npm run build

# Create necessary directories
RUN mkdir -p dist/server

# Copy server files
COPY server/ ./server/

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
    python3-dev \
    espeak \
    libespeak1 \
    libespeak-ng1 \
    espeak-ng \
    libespeak-ng-dev \
    python3-pip \
    python3-venv \
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

# Create virtual environment
ENV VIRTUAL_ENV=/opt/venv

# Install Python dependencies first (system-wide)
RUN pip3 install --no-cache-dir --upgrade pip setuptools wheel && \
    pip3 install --no-cache-dir \
        fastapi==0.115.0 \
        uvicorn[standard]==0.30.0 \
        numpy==1.19.5 \
        requests==2.26.0 \
        websockets==10.0 \
        python-dotenv==1.0.0 \
        soundfile==0.13.0 \
        sounddevice==0.5.1 \
        python-multipart==0.0.6 \
        pyaudio==0.2.14 \
        kokoro-tts==2.3.0

# Create virtual environment and copy packages
RUN python3 -m venv $VIRTUAL_ENV && \
    . $VIRTUAL_ENV/bin/activate && \
    pip install --no-cache-dir --upgrade pip setuptools wheel && \
    pip install --no-cache-dir \
        fastapi==0.115.0 \
        uvicorn[standard]==0.30.0 \
        numpy==1.19.5 \
        requests==2.26.0 \
        websockets==10.0 \
        python-dotenv==1.0.0 \
        soundfile==0.13.0 \
        sounddevice==0.5.1 \
        python-multipart==0.0.6 \
        pyaudio==0.2.14 \
        kokoro-tts==2.3.0 && \
    chown -R node:node $VIRTUAL_ENV && \
    chmod -R 755 $VIRTUAL_ENV && \
    ln -sf $VIRTUAL_ENV/bin/kokoro-tts /usr/local/bin/kokoro-tts

ENV PATH="$VIRTUAL_ENV/bin:$PATH" \
    PYTHONUNBUFFERED=1 \
    PYTHONPATH="/app"

# Create models directory and download model files
RUN mkdir -p /app/models \
    && wget -q https://github.com/nazdridoy/kokoro-tts/releases/download/v1.0.0/voices-v1.0.bin -O /app/models/voices-v1.0.bin \
    && wget -q https://github.com/nazdridoy/kokoro-tts/releases/download/v1.0.0/kokoro-v1.0.onnx -O /app/models/kokoro-v1.0.onnx \
    && chown -R node:node /app/models \
    && chmod 644 /app/models/*

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
    PYTHONPATH="/app/server/python-ws:/app" \
    PATH="/opt/venv/bin:/usr/local/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:/app/node_modules/.bin" \
    PYTHONUNBUFFERED=1 \
    VIRTUAL_ENV=/opt/venv \
    KOKORO_MODEL_PATH=/app/models/kokoro-v1.0.onnx \
    KOKORO_VOICES_PATH=/app/models/voices-v1.0.bin \
    KOKORO_TTS_BIN="/opt/venv/bin/kokoro-tts" \
    ENABLE_TTS="true" \
    DISABLE_TTS="false"

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

# Copy and set up startup script
COPY --chown=node:node start-services.sh /app/start-services.sh
RUN chmod +x /app/start-services.sh && \
    # Ensure node user has access to the virtual environment
    chown -R node:node /opt/venv && \
    chmod -R 755 /opt/venv

# Run as non-root user
USER node

# Install bash if not present
RUN apt-get update && apt-get install -y --no-install-recommends bash && rm -rf /var/lib/apt/lists/*

# Start the application using the startup script with bash
CMD ["bash", "/app/start-services.sh"]