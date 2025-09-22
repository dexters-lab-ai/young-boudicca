# Force complete rebuild - change this value to invalidate all caches
ARG CACHE_BUSTER=2025-09-22-18-35

# Add cache-busting timestamp to force rebuilds
ARG BUILD_TIMESTAMP=latest

# ============================================
# Python base stage - For Python dependencies
# ============================================
FROM python:3.11-slim as python-base

# Set environment variables
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Create and activate virtual environment
RUN python -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

# Install Python dependencies
WORKDIR /app
COPY server/requirements.txt .
RUN pip install --upgrade pip && \
    pip install -r requirements.txt

# ============================================
# Node.js build stage - For frontend build
# ============================================
FROM node:20-alpine as node-builder

# Add cache-busting echo to force layer rebuild
ARG BUILD_TIMESTAMP
RUN echo "Build timestamp: $BUILD_TIMESTAMP"

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

# Set working directory
WORKDIR /app

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
RUN npm run build

# ============================================
# Final stage - Minimal runtime
# ============================================
FROM node:20-alpine

# Add cache-busting echo to force layer rebuild
ARG BUILD_TIMESTAMP
RUN echo "Runtime build timestamp: $BUILD_TIMESTAMP"

# Install runtime dependencies and ensure tsx is available
RUN apk add --no-cache \
    python3 \
    && rm -rf /var/cache/apk/* \
    && npm install -g tsx \
    && npm list -g tsx \
    && echo "tsx version: $(tsx --version)"

# Create app directory structure
WORKDIR /app
RUN mkdir -p /app/dist /app/server /app/public/uploads

# Copy Python virtual environment
COPY --from=python-base /opt/venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

# Copy built application and node modules from node-builder
COPY --from=node-builder /app/dist ./dist
COPY --from=node-builder /app/public ./public
COPY --from=node-builder /app/package*.json ./
COPY --from=node-builder /app/node_modules ./node_modules
COPY --from=node-builder /usr/local/lib/node_modules /usr/local/lib/node_modules
COPY --from=node-builder /usr/local/bin/tsx /usr/local/bin/tsx

# Ensure NODE_PATH includes global node_modules
ENV NODE_PATH=/usr/local/lib/node_modules:${NODE_PATH:-}

# Copy server code
COPY server ./server

# Ensure the server has the correct permissions to serve static files
RUN chmod -R 755 /app/dist /app/public

# Set environment variables
ENV NODE_ENV=production \
    PORT=8787

# Expose port
EXPOSE 8787

# Health check
HEALTHCHECK --interval=30s --timeout=30s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:8787/health || exit 1

# Start the application using npm start to ensure proper initialization
CMD ["npm", "start"]