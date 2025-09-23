# Force complete rebuild - change this value to invalidate all caches
ARG CACHE_BUSTER=2025-09-23-02-42

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
    && rm -rf /var/lib/apt/lists/*

# Create and activate virtual environment
RUN python3 -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

# Install Python dependencies
WORKDIR /app
COPY server/python-ws/requirements.txt .
RUN pip install --upgrade pip && \
    pip install --no-cache-dir -r requirements.txt

# Create model directory
RUN mkdir -p /app/server/python-tts


# ============================================
# Final stage - Production runtime
# ============================================
FROM node:20-alpine

# Install runtime dependencies
RUN apk add --no-cache python3 netcat-openbsd \
    && rm -rf /var/cache/apk/* \
    && npm install -g tsx concurrently \
    && npm list -g tsx concurrently \
    && echo "tsx version: $(tsx --version)"

# Create app directory structure
WORKDIR /app
RUN mkdir -p /app/dist /app/server /app/public/uploads

# Copy Python virtual environment and server code
COPY --from=python-base /opt/venv /opt/venv
COPY server ./server

# Copy built application and node modules from node-builder
COPY --from=node-builder /app/dist ./dist
COPY --from=node-builder /app/public ./public
COPY --from=node-builder /app/package*.json ./
COPY --from=node-builder /app/node_modules ./node_modules
COPY --from=node-builder /usr/local/lib/node_modules /usr/local/lib/node_modules
COPY --from=node-builder /usr/local/bin/tsx /usr/local/bin/tsx

# Verify the copied files and fix permissions
RUN echo "Contents of /app:" && ls -la /app && \
    echo "\nContents of /app/dist:" && ls -la /app/dist && \
    echo "\nFiles in /app/dist:" && find /app/dist -type f | sort && \
    echo "\nPublic directory:" && ls -la /app/public

# Set environment variables
ENV NODE_ENV=production \
    PORT=8787 \
    PATH="/app/node_modules/.bin:/opt/venv/bin:$PATH" \
    NODE_PATH=/usr/local/lib/node_modules:${NODE_PATH:-}

# Fix permissions
RUN chmod -R 755 /app/dist /app/public /app/server

# Expose ports
EXPOSE 3000 8787 8899

# Health check - check all services
HEALTHCHECK --interval=30s --timeout=30s --start-period=20s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/ && \
      wget --no-verbose --tries=1 --spider http://localhost:8787/health && \
      wget --no-verbose --tries=1 --spider http://localhost:8899/ || exit 1

# Copy and set up the startup script
COPY start-services.sh /app/start-services.sh
RUN chmod +x /app/start-services.sh

# Set working directory
WORKDIR /app

# Start all services
CMD ["/bin/sh", "/app/start-services.sh"]