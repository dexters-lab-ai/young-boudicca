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
    && rm -rf /var/cache/apk/*

# Install Node.js dependencies with cache busting
COPY package.json package-lock.json ./
RUN echo "Cache buster: $CACHE_BUSTER" && \
    npm ci --no-audit --no-fund --unsafe-perm

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

# Install build dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Create and activate virtual environment
RUN python -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

# Install Python dependencies
WORKDIR /app
COPY server/python-ws/requirements.txt .
RUN pip install --upgrade pip && \
    pip install -r requirements.txt


# ============================================
# Final stage - Production runtime
# ============================================
FROM node:20-alpine

# Install runtime dependencies
RUN apk add --no-cache python3 \
    && rm -rf /var/cache/apk/* \
    && npm install -g tsx concurrently

# Create app directory structure
WORKDIR /app
RUN mkdir -p /app/dist /app/server /app/public/uploads

# Copy Python virtual environment and server code
COPY --from=python-base /opt/venv /opt/venv
COPY server ./server

# Copy built application and node modules from node-builder
COPY --from=node-builder /app/dist ./dist
COPY --from=node-builder /app/public ./public
COPY --from=node-builder /app/node_modules ./node_modules
COPY package*.json ./

# Set environment variables
ENV NODE_ENV=production \
    PORT=8787 \
    PATH="/app/node_modules/.bin:/opt/venv/bin:$PATH" \
    NODE_PATH=/app/node_modules

# Fix permissions
RUN chmod -R 755 /app/dist /app/public /app/server

# Expose ports
EXPOSE 3000 8787 8899

# Health check - check all services
HEALTHCHECK --interval=30s --timeout=30s --start-period=20s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/ && \
      wget --no-verbose --tries=1 --spider http://localhost:8787/health && \
      wget --no-verbose --tries=1 --spider http://localhost:8899/ || exit 1

# Start all services in production
CMD ["concurrently", \
     "tsx server/index.ts", \
     "vite preview --host 0.0.0.0 --port 3000", \
     "cd /app/server/python-ws && python3 -m uvicorn main:app --host 0.0.0.0 --port 8899" \
    ]