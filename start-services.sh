#!/bin/sh
set -e

# Log function with timestamp
log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1"
}

# Check if a service is running
check_service() {
    local port=$1
    local name=$2
    local max_retries=30
    local count=0
    
    log "Checking if $name is available on port $port"
    while ! nc -z localhost $port; do
        if [ $count -ge $max_retries ]; then
            log "Error: $name failed to start on port $port"
            return 1
        fi
        log "Waiting for $name to be ready... (attempt $((count+1))/$max_retries)"
        count=$((count+1))
        sleep 2
    done
    log "$name is ready on port $port"
    return 0
}

# Start services in background
start_services() {
    # Start Python TTS service
    log "Starting Python TTS service..."
    python3 -m uvicorn server.python-ws.main:app --host 0.0.0.0 --port 8899 &
    PYTHON_PID=$!
    
    # Start Node.js API server
    log "Starting Node.js API server..."
    tsx server/index.ts &
    NODE_PID=$!
    
    # Start Vite preview server
    log "Starting Vite preview server..."
    vite preview --host 0.0.0.0 --port 3000 &
    VITE_PID=$!
    
    # Check if services started successfully
    check_service 8899 "Python TTS" || exit 1
    check_service 8787 "Node.js API" || exit 1
    check_service 3000 "Vite Preview" || exit 1
    
    log "All services started successfully"
    
    # Keep script running and handle termination
    trap 'kill $PYTHON_PID $NODE_PID $VITE_PID; wait' SIGTERM SIGINT
    wait
}

# Main execution
log "=== Starting Boudi AI Services ==="
log "Environment: $NODE_ENV"
log "Python: $(python3 --version 2>&1 || echo 'Not available')"
log "Node: $(node --version)"
log "NPM: $(npm --version)"
log "Current directory: $(pwd)"
log "Directory contents:"
ls -la

# Start all services
start_services
