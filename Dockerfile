# ============================================
# Build stage - Node.js and Python setup
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
FROM node:20-alpine

# Install runtime dependencies
RUN apk add --no-cache \
    python3 \
    py3-pip \
    python3-dev \
    gcc \
    musl-dev \
    netcat-openbsd \
    && rm -rf /var/cache/apk/*

# Set up Python virtual environment
RUN python3 -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

# Install Python dependencies
COPY server/python-ws/requirements.txt /tmp/requirements.txt
RUN pip install --no-cache-dir -r /tmp/requirements.txt uvicorn[standard] && \
    rm /tmp/requirements.txt

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
    PATH="/app/node_modules/.bin:$PATH"

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