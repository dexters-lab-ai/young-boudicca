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

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    python3-pip \
    python3-dev \
    wget \
    supervisor \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /var/log/supervisor \
    && mkdir -p /etc/supervisor/conf.d

# Set up Python environment
RUN python3 -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

# Install Python dependencies
WORKDIR /app
COPY server/python-ws/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Create model directory
RUN mkdir -p /app/server/python-tts

# ============================================
# Final stage - Production runtime
# ============================================
FROM node:20-alpine

# Install runtime dependencies
RUN apk add --no-cache python3 py3-pip netcat-openbsd \
    && rm -rf /var/cache/apk/* \
    && npm install -g tsx concurrently \
    && npm list -g tsx concurrently \
    && echo "tsx version: $(tsx --version)"

# Copy Python virtual environment from build stage
COPY --from=python-base /opt/venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

# Create model directory
RUN mkdir -p /app/server/python-tts

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

# Create a startup script
RUN echo '#!/bin/sh\nset -e\n\n# Create a directory for PID files\nmkdir -p /var/run/services\n\n# Function to start a service and track its PID\nstart_service() {\n  local name="$1"\n  local cmd="$2"\n  local log_file="/var/log/${name}.log"\n  \n  echo "Starting $name..."\n  # Start the service, redirect output to log file, and store PID\n  $cmd >> "$log_file" 2>&1 &\n  echo $! > "/var/run/services/${name}.pid"\n  \n  # Give it a moment to start\n  sleep 2\n  \n  # Check if process is still running\n  if ! kill -0 $(cat "/var/run/services/${name}.pid") >/dev/null 2>&1; then\n    echo "Error: $name failed to start. Check $log_file for details."\n    exit 1\n  fi\n  \n  echo "$name started with PID $(cat "/var/run/services/${name}.pid")"\n}\n\n# Function to stop a service\nstop_service() {\n  local name="$1"\n  local pid_file="/var/run/services/${name}.pid"\n  \n  if [ -f "$pid_file" ]; then\n    local pid=$(cat "$pid_file")\n    echo "Stopping $name (PID: $pid)..."\n    kill -TERM "$pid" 2>/dev/null || true\n    rm -f "$pid_file"\n  fi\n}\n\n# Function to check if a service is running\nwait_for_service() {\n  local host=$1\n  local port=$2\n  local timeout=${3:-30}\n  \n  echo "Waiting for $host:$port..."\n  for i in $(seq 1 $timeout); do\n    if nc -z $host $port >/dev/null 2>&1; then\n      echo "$host:$port is available"\n      return 0\n    fi\n    sleep 1\n  done\n  echo "Timeout waiting for $host:$port"\n  return 1\n}\n\n# Cleanup function\ncleanup() {\n  echo "Shutting down services..."\n  stop_service "vite"\n  stop_service "nodejs"\n  stop_service "python-tts"\n  exit 0\n}\n\n# Trap signals for clean shutdown\ntrap cleanup TERM INT\n\n# Start the Python TTS service\nstart_service "python-tts" "cd /app/server/python-ws && /opt/venv/bin/uvicorn main:app --host 0.0.0.0 --port 8899"\n\n# Wait for Python service to be ready\nif ! wait_for_service localhost 8899; then\n  echo "Error: Python TTS service failed to start"\n  exit 1\nfi\n\n# Start the Node.js backend\nstart_service "nodejs" "cd /app && tsx server/index.ts"\n\n# Start the Vite preview server\nstart_service "vite" "cd /app && vite preview --host 0.0.0.0 --port 3000"\n\n# Keep the container running and monitor services\necho "All services started. Monitoring..."\nwhile sleep 5; do\n  for service in python-tts nodejs vite; do\n    pid_file="/var/run/services/${service}.pid"\n    if [ -f "$pid_file" ]; then\n      if ! kill -0 $(cat "$pid_file") >/dev/null 2>&1; then\n        echo "Error: $service has stopped unexpectedly"\n        exit 1\n      fi\n    else\n      echo "Error: PID file for $service not found"\n      exit 1\n    fi\n  done\ndone\n' > /app/startup.sh && chmod +x /app/startup.sh

# Create log directory and set permissions
RUN mkdir -p /var/log && \
    touch /var/log/python-tts.log && \
    chmod 777 /var/log/python-tts.log && \
    mkdir -p /var/run/services && \
    chmod 777 /var/run/services

# Create a test script to verify Python environment
RUN echo '#!/bin/sh\n\n# Test Python environment\necho "=== Testing Python Environment ==="\npython --version\npip --version\n\n# Create a separate Python script for testing\necho "\n=== Creating test script ==="\ncat > /tmp/test_imports.py << \''EOF2'\''\nimport sys\nimport os\nimport logging\n\nprint("Python path:", sys.path)\nprint("Current working directory:", os.getcwd())\nprint("Environment variables:", os.environ.get("PATH", "Not set"))\n\ntry:\n    from kokoro_onnx import Kokoro\n    from kokoro_onnx.tokenizer import Tokenizer\n    print("Successfully imported Kokoro TTS components")\nexcept ImportError as e:\n    print("Failed to import Kokoro TTS components:", e)\n    sys.exit(1)\nEOF2\n\n# Run the Python test\necho "\n=== Running Python Test ==="\npython /tmp/test_imports.py\n\necho "\n=== Testing File Permissions ==="\ntouch /var/log/test.log && echo "Successfully created test log file" || echo "Failed to create test log file"\n\necho "\n=== Environment Test Complete ==="\n' > /app/test_environment.sh && \
    chmod +x /app/test_environment.sh

# Create supervisor configuration with proper formatting
RUN echo '[supervisord]\n\
nodaemon=true\
logfile=/var/log/supervisord.log\
logfile_maxbytes=10MB\
logfile_backups=1\
loglevel=info\
pidfile=/var/run/supervisord.pid\
\n[program:tts]\
command=/opt/venv/bin/uvicorn main:app --host 0.0.0.0 --port 8899\
directory=/app/server/python-ws\
stdout_logfile=/var/log/tts.log\
stderr_logfile=/var/log/tts.error.log\
stdout_logfile_maxbytes=10MB\
stderr_logfile_maxbytes=10MB\
stdout_logfile_backups=5\
stderr_logfile_backups=5\
autostart=true\
autorestart=true\
startretries=3\
startsecs=10\
stopwaitsecs=10\
\n[program:nodejs]\
command=tsx server/index.ts\
directory=/app\
stdout_logfile=/var/log/nodejs.log\
stderr_logfile=/var/log/nodejs.error.log\
stdout_logfile_maxbytes=10MB\
stderr_logfile_maxbytes=10MB\
stdout_logfile_backups=5\
stderr_logfile_backups=5\
autostart=true\
autorestart=true\
startretries=3\
startsecs=10\
stopwaitsecs=10\
\n[program:vite]\
command=vite preview --host 0.0.0.0 --port 3000\
directory=/app\
stdout_logfile=/var/log/vite.log\
stderr_logfile=/var/log/vite.error.log\
stdout_logfile_maxbytes=10MB\
stderr_logfile_maxbytes=10MB\
stdout_logfile_backups=5\
stderr_logfile_backups=5\
autostart=true\
autorestart=true\
startretries=3\
startsecs=10\
stopwaitsecs=10\
' > /etc/supervisor/conf.d/services.conf

# Set working directory
WORKDIR /app

# Start all services using supervisord
CMD ["/usr/bin/supervisord", "-c", "/etc/supervisor/conf.d/services.conf"]