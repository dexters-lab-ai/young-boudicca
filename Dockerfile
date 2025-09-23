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

# Create and activate virtual environment
ENV VIRTUAL_ENV=/opt/venv
RUN python -m venv $VIRTUAL_ENV
ENV PATH="$VIRTUAL_ENV/bin:$PATH"

# Install Python dependencies
COPY server/python-ws/requirements.txt .
RUN python -m pip install --upgrade pip && \
    pip install --no-cache-dir -r requirements.txt uvicorn[standard] && \
    pip install --no-cache-dir kokoro-tts && \
    # Find where kokoro-tts is installed and create a symlink in /usr/local/bin
    KOKORO_PATH=$(python -c 'import shutil; print(shutil.which("kokoro-tts"))') && \
    if [ -n "$KOKORO_PATH" ]; then \
        ln -sf $KOKORO_PATH /usr/local/bin/kokoro-tts; \
    fi && \
    # Verify kokoro-tts is in PATH
    which kokoro-tts && \
    kokoro-tts --version && \
    rm requirements.txt

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
RUN mkdir -p /app/public/uploads && \
    chown -R node:node /app

# Set environment variables
ENV NODE_ENV=production \
    PORT=8787 \
    PYTHONPATH=/app/server/python-ws \
    PATH="/app/node_modules/.bin:$PATH" \
    PYTHONUNBUFFERED=1

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