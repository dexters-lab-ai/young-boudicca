######## ============================================
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

# Install Node.js dependencies
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund --unsafe-perm

# Copy source files
COPY . .

# Build the application
RUN npm run build

# ============================================
# Final production image
# ============================================
FROM node:20-alpine

# Install runtime dependencies
RUN apk add --no-cache \
    python3 \
    curl \
    eudev \
    libusb \
    udev \
    && rm -rf /var/cache/apk/*

# Copy Python environment
COPY --from=python-base /opt/venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

# Set working directory
WORKDIR /app

# Copy built files from builder
COPY --from=node-builder /app/node_modules ./node_modules
COPY --from=node-builder /app/dist ./dist
COPY --from=node-builder /app/public ./public

# Copy server files
COPY server ./server

# Set environment variables
ENV NODE_ENV=production \
    PORT=8787

# Expose port
EXPOSE $PORT

# Health check
HEALTHCHECK --interval=30s --timeout=30s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:$PORT/health || exit 1

# Start the application
CMD ["node", "dist/server/index.js"]
