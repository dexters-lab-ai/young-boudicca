#!/bin/sh
set -e

# Set up logging
log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1"
}

# Check if a service is running
check_service() {
    local port=$1
    local name=$2
    local path=${3:-/}
    local max_retries=30  # Increased retries for slower systems
    local count=0
    
    log "Checking if $name is available on port $port"
    while true; do
        # First check if port is open
        if nc -z localhost $port; then
            # Then check if the service responds to HTTP requests
            if [ -n "$path" ] && [ "$path" != "/" ]; then
                if curl -s -f "http://localhost:${port}${path}" >/dev/null; then
                    log "$name is ready on port $port"
                    return 0
                fi
            else
                log "$name is ready on port $port"
                return 0
            fi
        fi
        
        if [ $count -ge $max_retries ]; then
            log "Error: $name failed to start on port $port"
            return 1
        fi
        
        log "Waiting for $name to be ready... (attempt $((count+1))/$max_retries)"
        count=$((count+1))
        sleep 2
    done
}

# Start services in sequence
start_services() {
    # Start Python TTS service first
    log "Starting Python TTS service..."
    # Activate virtual environment and set Python path
    export PYTHONPATH="/app:$PYTHONPATH"
    source /opt/venv/bin/activate
    
    # Verify Python path and modules
    log "Python path: $PYTHONPATH"
    python -c "import sys; print('Python sys.path:', sys.path)" || true
    
    # Check if kokoro-tts is installed and in PATH
    if ! command -v kokoro-tts &> /dev/null; then
        log "kokoro-tts not found. Installing using uv..."
        # Try installing with uv (recommended method)
        if command -v uv &> /dev/null; then
            uv tool install kokoro-tts || {
                log "Failed to install kokoro-tts with uv. Trying pip..."
                pip install --no-cache-dir kokoro-tts || {
                    log "Failed to install kokoro-tts with pip. TTS will be disabled."
                    export DISABLE_TTS=true
                }
            }
        else
            log "uv not found. Installing kokoro-tts with pip..."
            pip install --no-cache-dir kokoro-tts || {
                log "Failed to install kokoro-tts. TTS will be disabled."
                export DISABLE_TTS=true
            }
        fi
    fi

    # Verify kokoro-tts installation
    if command -v kokoro-tts &> /dev/null; then
        log "Verifying kokoro-tts installation..."
        if kokoro-tts --version &> /dev/null; then
            log "kokoro-tts is working correctly (version: $(kokoro-tts --version 2>&1 | head -n 1 || echo 'unknown'))"
            export ENABLE_TTS=true
            export DISABLE_TTS=false
        else
            log "Warning: kokoro-tts is installed but not working properly. TTS may not function."
            export DISABLE_TTS=true
            export ENABLE_TTS=false
        fi
    else
        log "Warning: kokoro-tts is not available. TTS will be disabled."
        export DISABLE_TTS=true
        export ENABLE_TTS=false
    fi
    
    # Start the service
    cd /app && python -m uvicorn server.python-ws.main:app --host 0.0.0.0 --port 8899 &
    PYTHON_PID=$!
    check_service 8899 "Python TTS" "/docs" || { kill $PYTHON_PID 2>/dev/null; exit 1; }

    # Then start Node.js API server
    log "Starting Node.js API server..."
    cd /app
    if [ -f "dist/server/index.js" ]; then
        log "Starting compiled server from dist/server/index.js"
        node --import tsx dist/server/index.js &
    elif [ -f "server/index.ts" ]; then
        log "Starting TypeScript server directly (development mode)"
        node --import tsx server/index.ts &
    else
        log "Error: Could not find server entry point"
        ls -la dist/ server/ 2>/dev/null || true
        exit 1
    fi
    NODE_PID=$!
    check_service 8787 "Node.js API" "/health" || { kill $PYTHON_PID $NODE_PID 2>/dev/null; exit 1; }

    # Finally start Vite preview
    log "Starting Vite preview server..."
    cd /app && npx vite preview --host 0.0.0.0 --port 3000 &
    VITE_PID=$!
    check_service 3000 "Vite Preview" "/" || { kill $PYTHON_PID $NODE_PID $VITE_PID 2>/dev/null; exit 1; }

    log "All services started successfully"
    
    # Cleanup on exit
    trap 'log "Shutting down services..."; kill $PYTHON_PID $NODE_PID $VITE_PID 2>/dev/null; wait' EXIT TERM INT
    
    # Keep the script running
    while true; do sleep 1; done
}

# Main execution
log "=== Starting Boudi AI Services ==="
log "Environment: $NODE_ENV"
log "Python: $(python --version 2>&1 || echo 'Not available')"
log "Node: $(node --version)"
log "NPM: $(npm --version)"
log "Current directory: $(pwd)"

# Start all services
start_services
