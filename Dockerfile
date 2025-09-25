# ============================================
# Base stage for Python dependencies
# ============================================
FROM python:3.11.7-slim as python-base

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    python3-dev \
    python3-pip \
    python3-venv \
    python3-wheel \
    libsndfile1 \
    wget \
    git \
    && rm -rf /var/lib/apt/lists/*

# Create virtual environment
ENV VIRTUAL_ENV=/opt/venv
RUN python -m venv $VIRTUAL_ENV
ENV PATH="$VIRTUAL_ENV/bin:$PATH"

# Upgrade pip and install build tools
RUN pip install --no-cache-dir -U pip setuptools wheel

# Install Python dependencies
COPY server/python-tts/requirements.txt /tmp/
RUN pip install --no-cache-dir -r /tmp/requirements.txt

# Download model files
RUN mkdir -p /app/models && \
    wget -q https://github.com/nazdridoy/kokoro-tts/releases/download/v1.0.0/voices-v1.0.bin -O /app/models/voices-v1.0.bin && \
    wget -q https://github.com/nazdridoy/kokoro-tts/releases/download/v1.0.0/kokoro-v1.0.onnx -O /app/models/kokoro-v1.0.onnx

# ============================================
# Build stage - Node.js setup
# ============================================
FROM node:20-slim as builder

# Copy Python environment
COPY --from=python-base /opt/venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci

# Copy source code
COPY . .

# Build application
RUN npm run build

# ============================================
# Production stage
# ============================================
FROM python:3.11-slim as runtime

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    wget \
    gnupg \
    netcat-openbsd \
    && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

# Copy Python environment
COPY --from=python-base /opt/venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

# Copy built application
COPY --from=builder /app/dist /app/dist
COPY --from=builder /app/public /app/public
COPY --from=builder /app/server /app/server
COPY --from=builder /app/package*.json /app/
COPY --from=builder /app/start-services.sh /app/

# Set working directory
WORKDIR /app

# Create directories and set permissions
RUN mkdir -p /app/models && \
    wget -q https://github.com/nazdridoy/kokoro-tts/releases/download/v1.0.0/voices-v1.0.bin -O /app/models/voices-v1.0.bin && \
    wget -q https://github.com/nazdridoy/kokoro-tts/releases/download/v1.0.0/kokoro-v1.0.onnx -O /app/models/kokoro-v1.0.onnx && \
    chmod +x start-services.sh

# Set environment variables
ENV NODE_ENV=production \
    PORT=8787 \
    KOKORO_MODEL_PATH=/app/models/kokoro-v1.0.onnx \
    KOKORO_VOICES_PATH=/app/models/voices-v1.0.bin

# Expose ports
EXPOSE 3000 8787 8899

# Start services
CMD ["./start-services.sh"]