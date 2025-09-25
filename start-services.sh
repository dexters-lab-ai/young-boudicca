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
    log "Python: $(which python)"
    log "Python version: $(python --version 2>&1 || echo 'Not found')"
    log "Python path: $PYTHONPATH"
    log "Working directory: $(pwd)"
    log "Contents of /app/server/python-tts: $(ls -la /app/server/python-tts 2>/dev/null || echo 'Not Found')"
    
    # Start the Python TTS service
    log "=== Starting Python TTS Service ==="
    log "Current directory: $(pwd)"
    log "Python path: $(which python3)"
    log "Python version: $(python3 --version)"
    
    # Check if the Python TTS service directory exists
    if [ ! -d "/app/server/python-tts" ]; then
        log "Error: Python TTS service directory not found at /app/server/python-tts"
        log "Current directory contents: $(ls -la /app/)"
        log "Server directory contents: $(ls -la /app/server/ 2>/dev/null || echo 'No server directory')"
        exit 1
    fi
    
    # Change to the Python TTS service directory
    cd /app/server/python-tts || { log "Failed to change to python-tts directory"; exit 1; }
    
    # Log the directory contents for debugging
    log "Python TTS service directory contents: $(ls -la)"
    
    # Verify Python environment and dependencies
    log "=== Verifying Python Environment ==="
    python3 -c "
import sys
print(f'Python sys.path: {sys.path}')
try:
    import fastapi
    import uvicorn
    from kokoro_onnx import Kokoro
    from kokoro_onnx.config import SAMPLE_RATE
    from kokoro_onnx.tokenizer import Tokenizer
    print('Successfully imported all required modules')
except ImportError as e:
    print(f'Error importing module: {e}')
    import traceback
    traceback.print_exc()
    sys.exit(1)
"
    
    # Start the Python TTS service in the background
    log "Starting Python TTS FastAPI service on port 8899..."
    nohup python3 -m uvicorn kokoro_server:app --host 0.0.0.0 --port 8899 --workers 1 --log-level info > /app/tts-service.log 2>&1 &
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

# Start Python TTS service
cd /app/server/python-tts
PYTHONPATH=/app/server/python-tts uvicorn kokoro_server:app --host 0.0.0.0 --port 8899 &
