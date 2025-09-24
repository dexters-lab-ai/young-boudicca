#!/bin/bash
set -e

# Ensure we're using bash for better compatibility
export SHELL=/bin/bash

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
    # Activate Python virtual environment
    if [ -f "/opt/venv/bin/activate" ]; then
        log "Activating Python virtual environment..."
        . /opt/venv/bin/activate
    else
        log "Warning: Python virtual environment not found at /opt/venv"
    fi

    # Set Python path
    export PYTHONPATH="/app:/app/server:$PYTHONPATH"
    
    # Start Python TTS service first
    log "Starting Python TTS service..."
    
    # Ensure the output directory exists
    mkdir -p /app/logs
    
    # Set Python path and environment variables
    export PYTHONPATH="/app:/app/server:$PYTHONPATH"
    export PATH="/opt/venv/bin:$PATH"
    
    # Activate virtual environment
    if [ -f "/opt/venv/bin/activate" ]; then
        # shellcheck source=/dev/null
        . /opt/venv/bin/activate
    else
        log "Error: Virtual environment not found at /opt/venv/bin/activate"
        exit 1
    fi
    
    # Set Python path and verify environment
    log "Python path: $PYTHONPATH"
    python -c "import sys; print('Python sys.path:', sys.path)" || true
    
    # Verify kokoro-tts is available
    log "=== Verifying kokoro-tts installation ==="
    log "Environment:"
    log "  PATH: $PATH"
    log "  VIRTUAL_ENV: $VIRTUAL_ENV"
    log "  Python: $(which python)"
    log "  Python version: $(python --version 2>&1 || echo 'Not found')"
    
    # Check if kokoro-tts is available via KOKORO_TTS_BIN or in PATH
    KOKORO_BIN="${KOKORO_TTS_BIN:-$(command -v kokoro-tts 2>/dev/null || echo '')}"
    
    if [ -n "$KOKORO_BIN" ] && [ -x "$KOKORO_BIN" ]; then
        log "kokoro-tts found at: $KOKORO_BIN"
        export KOKORO_TTS_BIN="$KOKORO_BIN"
        export ENABLE_TTS=true
        export DISABLE_TTS=false
        
        # Test kokoro-tts execution
        if ! $KOKORO_BIN --help >/dev/null 2>&1; then
            log "Warning: kokoro-tts failed to execute. Check shared libraries with 'ldd $KOKORO_BIN'"
            ldd "$KOKORO_BIN" 2>/dev/null || true
            export ENABLE_TTS=false
            export DISABLE_TTS=true
        fi
    else
        log "Error: kokoro-tts not found. TTS will be disabled."
        log "Searched in:"
        which -a kokoro-tts 2>/dev/null || true
        find /opt/venv -name kokoro-tts 2>/dev/null || true
        export ENABLE_TTS=false
        export DISABLE_TTS=true
    fi
    
    # Verify Python module and version
    if [ "$ENABLE_TTS" = "true" ]; then
    
    # Set environment variables
    export KOKORO_MODEL_PATH="/app/models/kokoro-v1.0.onnx"
    export KOKORO_VOICES_PATH="/app/models/voices-v1.0.bin"
    export PYTHONUNBUFFERED=1
    
    # Ensure model files exist
    if [ ! -f "$KOKORO_MODEL_PATH" ] || [ ! -f "$KOKORO_VOICES_PATH" ]; then
        log "Error: Model files not found at $KOKORO_MODEL_PATH and $KOKORO_VOICES_PATH"
        log "Available files in /app/models/:"
        ls -la /app/models/ 2>/dev/null || log "Directory /app/models/ does not exist"
        return 1
    fi
    
    log "Starting TTS service with model: $KOKORO_MODEL_PATH"
    
    # Start the service in the background
    python -m uvicorn app:app \
        --host 0.0.0.0 \
        --port 8899 \
        --workers 1 \
        --log-level info \
        --no-access-log \
        --timeout-keep-alive 300 &
        
    TTS_PID=$!
    
    # Wait for the service to start
    if ! wait_for_service "0.0.0.0" 8899 "TTS Service"; then
        log "Error: Failed to start TTS service"
        kill -TERM "$TTS_PID" 2>/dev/null || true
        return 1
    fi
    
    log "TTS service started with PID: $TTS_PID"
    echo "$TTS_PID"
    return 0
}

# Function to start the Node.js API server
start_node_server() {
    log "Starting Node.js API server..."
    
    cd /app || {
        log "Error: Failed to change to app directory"
        return 1
    }
    
    # Set NODE_ENV if not set
    export NODE_ENV="${NODE_ENV:-production}"
    
    # Start the appropriate server based on build type
    if [ -f "dist/server/index.js" ]; then
        log "Starting production server from dist/server/index.js"
        node --import tsx dist/server/index.js &
    elif [ -f "server/index.ts" ]; then
        log "Starting development server from server/index.ts"
        node --import tsx server/index.ts &
    else
        log "Error: Could not find server entry point"
        ls -la dist/ server/ 2>/dev/null || true
        return 1
    fi
    
    NODE_PID=$!
    
    # Wait for the server to start
    if ! wait_for_service "0.0.0.0" 8787 "Node.js API"; then
        log "Error: Failed to start Node.js server"
        kill -TERM "$NODE_PID" 2>/dev/null || true
        return 1
    fi
    
    log "Node.js server started with PID: $NODE_PID"
    echo "$NODE_PID"
    return 0
}

# Function to start the Vite preview server
start_vite_preview() {
    log "Starting Vite preview server..."
    
    cd /app || {
        log "Error: Failed to change to app directory"
        return 1
    }
    
    # Only start Vite in production mode
    if [ "$NODE_ENV" = "production" ] && [ -d "/app/dist/client" ]; then
        npx vite preview --host 0.0.0.0 --port 3000 --strictPort &
        VITE_PID=$!
        
        if ! wait_for_service "0.0.0.0" 3000 "Vite Preview"; then
            log "Error: Failed to start Vite preview"
            kill -TERM "$VITE_PID" 2>/dev/null || true
            return 1
        fi
        
        log "Vite preview started with PID: $VITE_PID"
        echo "$VITE_PID"
        return 0
    else
        log "Skipping Vite preview (NODE_ENV=$NODE_ENV, dist/client not found)"
        echo ""
        return 0
    fi
}

# Cleanup function
cleanup() {
    log "Shutting down services..."
    
    # Send SIGTERM to all child processes
    pkill -P $$ || true
    
    # Wait for all child processes to exit
    wait || true
    
    log "All services have been stopped"
    exit 0
}

# Main function
main() {
    log "=== Starting Boudi AI Services ==="
    log "Environment: ${NODE_ENV:-development}"
    
    # Set up trap for clean shutdown
    trap cleanup EXIT TERM INT
    
    # Start services
    TTS_PID=$(start_tts_service) || exit 1
    NODE_PID=$(start_node_server) || exit 1
    VITE_PID=$(start_vite_preview) || exit 1
    
    log "All services started successfully"
    log "TTS Service PID: ${TTS_PID:--}"
    log "Node.js Server PID: ${NODE_PID:--}"
    log "Vite Preview PID: ${VITE_PID:--}"
    
    # Monitor services and restart if they fail
    while true; do
        # Check TTS service
        if [ -n "$TTS_PID" ] && ! is_service_running "$TTS_PID" "TTS Service"; then
            log "TTS Service is not running, restarting..."
            TTS_PID=$(start_tts_service) || {
                log "Failed to restart TTS Service"
                sleep 5
                continue
            }
        fi
        
        # Check Node.js server
        if [ -n "$NODE_PID" ] && ! is_service_running "$NODE_PID" "Node.js Server"; then
            log "Node.js Server is not running, restarting..."
            NODE_PID=$(start_node_server) || {
                log "Failed to restart Node.js Server"
                sleep 5
                continue
            }
        fi
        
        # Check Vite preview if it was started
        if [ -n "$VITE_PID" ] && [ "$VITE_PID" != "" ] && ! is_service_running "$VITE_PID" "Vite Preview"; then
            log "Vite Preview is not running, restarting..."
            VITE_PID=$(start_vite_preview) || {
                log "Failed to restart Vite Preview"
                sleep 5
                continue
            }
        fi
        
        # Sleep before next check
        sleep 5
    done
}

# Run the main function
main "$@"
