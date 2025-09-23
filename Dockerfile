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
    && rm -rf /var/cache/apk/*

# Set working directory
WORKDIR /app

# Install Node.js dependencies
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund --unsafe-perm

# Copy application code
COPY . .

# Build the application
RUN npm run build

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

# Install Node.js 20
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

# Create and activate virtual environment
ENV VIRTUAL_ENV=/opt/venv
RUN python -m venv $VIRTUAL_ENV
ENV PATH="$VIRTUAL_ENV/bin:$PATH"

# Install Python dependencies
COPY server/python-ws/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt uvicorn[standard] && \
    rm requirements.txt

# Set up application directory
WORKDIR /app

# Copy built files from builder
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/server ./server
COPY --from=builder /app/public ./public

# Install production dependencies
RUN npm ci --only=production --no-audit --no-fund --unsafe-perm

# Create necessary directories
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

# Start services
CMD ["/bin/sh", "/app/start-services.sh"]