#!/bin/bash
set -e

# Enhanced debug logging
debug_environment() {
    echo "=== Environment Debug ==="
    echo "PWD: $(pwd)"
    echo "Python TTS Directory Contents:"
    ls -la /app/server/python-tts/
    echo "Python sys.path:"
    python3 -c "import sys; print('\n'.join(sys.path))"
    echo "======================="
}

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

# Function to check if a port is available
check_port() {
    nc -z localhost $1 >/dev/null 2>&1
    return $?
}

# Function to wait for a port to become available
wait_for_port() {
    local port=$1
    local service=$2
    local retries=30
    
    echo "Waiting for $service on port $port..."
    while check_port $port; do
        retries=$((retries - 1))
        if [ $retries -eq 0 ]; then
            echo "Error: Port $port is still in use after waiting"
            exit 1
        fi
        sleep 1
    done
    echo "$service port $port is available"
}

# Ensure required environment variables are set
export NODE_ENV=${NODE_ENV:-production}
export PORT=${PORT:-8787}
export KOKORO_MODEL_PATH=${KOKORO_MODEL_PATH:-/app/models/kokoro-v1.0.onnx}
export KOKORO_VOICES_PATH=${KOKORO_VOICES_PATH:-/app/models/voices-v1.0.bin}

# Check if model files exist
if [ ! -f "$KOKORO_MODEL_PATH" ] || [ ! -f "$KOKORO_VOICES_PATH" ]; then
    echo "Error: Required model files not found"
    echo "KOKORO_MODEL_PATH: $KOKORO_MODEL_PATH"
    echo "KOKORO_VOICES_PATH: $KOKORO_VOICES_PATH"
    exit 1
fi

# Wait for ports to be available
wait_for_port 3000 "Frontend"
wait_for_port 8787 "Backend"
wait_for_port 8899 "TTS Server"

# Start services in sequence
start_services() {
    # Start Python TTS service first
    log "Starting Python TTS service..."
    
    # Set up environment
    export PYTHONUNBUFFERED=1
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
    
    # Verify Python environment
    log "=== Python Environment ==="
    log "Python version: $(python3 --version)"
    log "Python path: $PYTHONPATH"
    log "Working directory: $(pwd)"
    
    # List contents of key directories
    log "=== Directory Contents ==="
    log "Python TTS directory:"
    ls -la /app/server/python-tts/
    log "Models directory:"
    ls -la /app/models/

    # Change to server directory
    cd /app/server || {
        log "ERROR: Failed to change to server directory"
        exit 1
    }

    # Check if main.py exists and is readable
    log "Checking main.py as appuser..."
    if [ -r /app/server/main.py ]; then
        log "main.py exists and is readable by appuser"
    else
        log "ERROR: main.py not found or not readable by appuser"
        ls -la /app/server/
        exit 1
    fi

    # Start the WebSocket server
    log "Starting WebSocket server..."
    PYTHONPATH=/app/server python3 -m uvicorn main:app --host 0.0.0.0 --port 8899 --log-level debug &

    TTS_PID=$!
    
    # Wait for the service to start
    sleep 5
    
    # Check if the service is running
    if ! ps -p $TTS_PID > /dev/null; then
        log "Error: Failed to start Python TTS service"
        log "TTS service log output:"
        cat /app/tts-service.log
        exit 1
    fi
    
    # Verify the service is responding
    log "Verifying TTS service health..."
    if ! curl -s http://localhost:8899/health | grep -q '"status":"ok"'; then
        log "Error: TTS service health check failed"
        log "TTS service log output:"
        cat /app/tts-service.log
        exit 1
    fi
    
    log "Python TTS service started successfully with PID $TTS_PID"
    log "TTS service log is available at /app/tts-service.log"
    log "TTS service health check: $(curl -s http://localhost:8899/health)"
    
    # Start WebSocket server
    log "Starting WebSocket server..."
    cd /app/server/python-ws
    PYTHONPATH=/app/server python3 main.py &
    WS_PID=$!
    cd - > /dev/null  # Return to the previous directory
    
    # Wait for the WebSocket server to start
    sleep 3
    
    # Check if the WebSocket server is running
    if ! ps -p $WS_PID > /dev/null; then
        log "Error: Failed to start WebSocket server"
        log "WebSocket server log output:"
        cat /app/ws-server.log
        exit 1
    fi
    
    log "WebSocket server started successfully with PID $WS_PID"
    log "WebSocket server is available at ws://localhost:8900/ws/tts"
    
    # Python imports were already verified above, no need to verify again
    
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
        log "=== Verifying Python Module ==="
        if ! python -c "\
import kokoro_tts; \
print('kokoro-tts module path:', kokoro_tts.__file__); \
print('kokoro-tts version:', getattr(kokoro_tts, '__version__', 'unknown')); \
print('Default model path:', getattr(kokoro_tts, 'DEFAULT_MODEL_PATH', 'Not set')); \
print('Default voices path:', getattr(kokoro_tts, 'DEFAULT_VOICES_PATH', 'Not set'))" 2>/dev/null; then
            log "Error: Failed to import kokoro_tts Python module"
            python -c "import sys; print('\nPython path:'); print('\n'.join(sys.path))" 2>/dev/null || true
            export ENABLE_TTS=false
            export DISABLE_TTS=true
        else
            log "kokoro_tts module imported successfully"
            
            # Test voice listing with better error handling
            log "=== Testing Voice Listing ==="
            if ! python -c "\
import kokoro_tts; \
print('Using model:', '$KOKORO_MODEL_PATH'); \
print('Using voices:', '$KOKORO_VOICES_PATH'); \
print('Voices:'); \
kokoro_tts.list_voices()" 2>&1; then
                log "Warning: Failed to list voices. This might be expected if models are not loaded yet."
                log "Model files in $(dirname "$KOKORO_MODEL_PATH"):"
                ls -la "$(dirname "$KOKORO_MODEL_PATH")" 2>/dev/null || true
            fi
        fi
    fi
    
    # Verify Python environment before starting services
    echo "Verifying Python environment..."
    python /app/server/python-tts/verify_env.py || exit 1

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
