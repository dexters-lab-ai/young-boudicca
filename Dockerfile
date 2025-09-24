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
    portaudio19-dev \
    python3-pyaudio \
    python3-dev \
    espeak \
    libespeak1 \
    libespeak-ng1 \
    espeak-ng \
    libespeak-ng-dev \
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
    # Install system dependencies and Python packages
    apt-get update && apt-get install -y --no-install-recommends wget && \
    rm -rf /var/lib/apt/lists/* && \
    # Install Python requirements
    pip install --no-cache-dir -r requirements.txt uvicorn[standard] && \
    pip install --no-cache-dir kokoro-tts sounddevice numpy pyaudio && \
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
    KOKORO_VOICES_PATH=/app/models/voices-v1.0.bin

# Expose ports
EXPOSE 3000 8787 8899

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD nc -z localhost 3000 && nc -z localhost 8787 && nc -z localhost 8899 || exit 1

# Copy startup script
COPY start-services.sh /app/start-services.sh
RUN chmod +x /app/start-services.sh

# Run as non-root user
USER node

# Start the application
CMD ["sh", "-c", "node --import tsx dist/server/index.js"]