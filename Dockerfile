# ============================================
# Build stage - Node.js setup
# ============================================
FROM node:20-alpine as builder

# Install build dependencies with version pinning
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

# Set working directory
WORKDIR /app

# Copy package files first for better caching
COPY package.json package-lock.json ./

# Install Node.js dependencies
RUN npm ci --no-audit --no-fund --unsafe-perm

# Install TypeScript globally
RUN npm install -g typescript

# Copy the rest of the application
COPY . .

# Install Python TTS service dependencies
RUN python3 -m pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir fastapi uvicorn kokoro-tts

# Build the application
RUN npm run build

# Verify server files
RUN mkdir -p /app/server/python-tts && \
    echo "=== Server files in /app/server ===" && \
    ls -la /app/server/

# Create server package.json for ES modules
RUN mkdir -p /app/dist/server && \
    echo '{"type": "module"}' > /app/dist/server/package.json

# Copy and build TypeScript files for server
COPY tsconfig.server.json ./
RUN npx tsc --project tsconfig.server.json

# Verify the build
RUN echo "=== Build output ===" && \
    ls -la dist/server/

# ============================================
# Final stage - Production
# ============================================
FROM node:20-alpine

# Install runtime dependencies
RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    gcc \
    linux-headers \
    udev \
    eudev-dev \
    libusb-dev \
    portaudio-dev \
    alsa-lib-dev \
    && rm -rf /var/cache/apk/*

# Install Python dependencies
RUN python3 -m pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir fastapi uvicorn kokoro-tts

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

# Set up application directory
WORKDIR /app

# Copy application files
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package*.json ./

# Create Python TTS service directory
RUN mkdir -p /app/python-tts

# Copy Python TTS service files
COPY --from=builder /app/server/python-tts/ /app/python-tts/

# Install Python TTS service dependencies
WORKDIR /app/python-tts
RUN pip install --no-cache-dir -r requirements.txt

# Copy start script and make it executable
COPY --from=builder /app/start-services.sh .
RUN chmod +x /app/start-services.sh

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

# Set environment variables and start the application
ENV PYTHONPATH="/app:/app/server"
WORKDIR /app
CMD ["bash", "-c", "export PATH=/opt/venv/bin:$PATH && . /opt/venv/bin/activate && /app/start-services.sh"]