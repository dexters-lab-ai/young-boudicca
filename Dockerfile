######## Python build stage ########
FROM python:3.11-slim as python-base

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
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir -r requirements.txt

######## Node build stage ########
FROM node:20-alpine as node-base

# Install build dependencies
RUN apk add --no-cache python3 make g++

# Install Node.js dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# Copy source and build
COPY . .
RUN npm run build

######## Final stage ########
FROM node:20-alpine

# Install runtime dependencies
RUN apk add --no-cache python3 wget

# Copy Python environment
COPY --from=python-base /opt/venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

# Set working directory
WORKDIR /app

# Copy built files from node-base
COPY --from=node-base /app/node_modules ./node_modules
COPY --from=node-base /app/dist ./dist
COPY --from=node-base /app/package.json .

# Create server directory structure
RUN mkdir -p /app/server/python-tts

# Copy server files (excluding those that might be in .dockerignore)
COPY server/ /app/server/

# Download Kokoro TTS models
WORKDIR /app/server
RUN wget -q https://github.com/nazdridoy/kokoro-tts/releases/download/v1.0.0/voices-v1.0.bin && \
    wget -q https://github.com/nazdridoy/kokoro-tts/releases/download/v1.0.0/kokoro-v1.0.onnx

# Set permissions
RUN chmod -R 755 /app/server

# Set working directory
WORKDIR /app

# Install curl for healthcheck
RUN apk add --no-cache curl

# Environment variables
ENV NODE_ENV=production
ENV PORT=8787

# Expose port
EXPOSE 8787

# Healthcheck
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS http://127.0.0.1:${PORT}/ >/dev/null || exit 1

# Start the TypeScript server with tsx (Node 20+)
CMD ["node", "--import", "tsx", "server/index.ts"]
