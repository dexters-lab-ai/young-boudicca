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
    # Start Python TTS service first
    log "=== Starting Python TTS Service ==="
    
    # Set working directory
    cd "$PYTHON_SERVICE_DIR"
    
    # Log environment and service files
    log "Working directory: $(pwd)"
    log "Environment variables:"
    env | grep -E 'PATH|PYTHON|KOKORO' || true
    
    log "\nService files:"
    ls -la .
    
    # Verify model files exist
    if [ ! -f "$KOKORO_MODEL_PATH" ] || [ ! -f "$KOKORO_VOICES_PATH" ]; then
        log "Error: Could not find model files in $PYTHON_SERVICE_DIR"
        log "Contents of $PYTHON_SERVICE_DIR:"
        ls -la "$PYTHON_SERVICE_DIR" 2>&1 || true
        exit 1
    fi
    
    log "\nModel files found:"
    ls -l "$KOKORO_MODEL_PATH" "$KOKORO_VOICES_PATH"
    
    # Verify Python can find the server module
    log "Checking Python module paths..."
    log "Contents of /app:"
    ls -la /app 2>&1 || true
    
    if [ -d "/app/server/python-ws" ]; then
        log "Found /app/server/python-ws directory"
        log "Contents of /app/server/python-ws:"
        ls -la /app/server/python-ws/ 2>&1 || true
        
        # Try to import the module using the correct path
        if python -c "import sys; sys.path.append('/app'); from server.python_ws import main" 2>/dev/null; then
            log "Successfully imported server.python_ws"
        elif python -c "import sys; sys.path.append('/app'); from server.python-ws import main" 2>/dev/null; then
            log "Successfully imported server.python-ws"
        else
            log "Error: Could not import server module. Python path:"
            python -c "import sys; print('\n'.join(sys.path))"
            exit 1
        fi
    else
        log "Error: /app/server/python-ws directory not found"
        exit 1
    fi
    
    # Debug information
    log "=== Environment ==="
    log "Working directory: $(pwd)"
    log "PYTHONPATH: $PYTHONPATH"
    log "PATH: $PATH"
    log "Python: $(which python)"
    log "Python version: $(python --version 2>&1 || echo 'Error getting Python version')"
    log "Python modules path: $(python -c 'import sys; print("\n".join(sys.path))')"
    
    # Verify Python environment
    log "=== Python Environment ==="
    log "Python: $(which python)"
    log "Python version: $(python --version 2>&1 || echo 'Error getting Python version')"
    log "Python path: $PYTHONPATH"
    python -c "import sys; print('Python sys.path:', sys.path)" || true
    
    # Verify kokoro-tts installation
    log "\n=== Verifying kokoro-tts ==="
    log "Environment:"
    log "VIRTUAL_ENV: ${VIRTUAL_ENV:-Not set}"
    log "PYTHONPATH: $PYTHONPATH"
    log "KOKORO_MODEL_PATH: ${KOKORO_MODEL_PATH:-Not set}"
    log "KOKORO_VOICES_PATH: ${KOKORO_VOICES_PATH:-Not set}"
    
    # Check if kokoro-tts is in PATH
    KOKORO_TTS_CMD=$(which kokoro-tts 2>/dev/null || echo "kokoro-tts not found")
    log "kokoro-tts binary: $KOKORO_TTS_CMD"
    
    # List available voices using the correct CLI command
    log "\n=== Verifying Voice Listing ==="
    log "Using model: $KOKORO_MODEL_PATH"
    log "Using voices: $KOKORO_VOICES_PATH"
    
    # List available voices using the CLI
    log "Listing available voices:"
    kokoro-tts --help-voices 2>&1 || log "Failed to list voices. This might be expected if models are not loaded yet."
    
    # Verify model files
    log "\n=== Verifying Model Files ==="
    log "Model directory: /app/models"
    ls -la /app/models/ 2>&1 || log "Error listing /app/models"
    
    [ -f "$KOKORO_MODEL_PATH" ] && log "Model file found: $KOKORO_MODEL_PATH" || log "Error: Model file not found"
    [ -f "$KOKORO_VOICES_PATH" ] && log "Voices file found: $KOKORO_VOICES_PATH" || log "Error: Voices file not found"
    
    if [ -n "$KOKORO_TTS_CMD" ] && [ "$KOKORO_TTS_CMD" != "kokoro-tts not found" ]; then
        log "kokoro-tts found at: $KOKORO_TTS_CMD"
        export KOKORO_TTS_BIN="$KOKORO_TTS_CMD"
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
            
            # Test voice listing with the CLI command
            log "=== Testing Voice Listing ==="
            log "Using model: $KOKORO_MODEL_PATH"
            log "Using voices: $KOKORO_VOICES_PATH"
            log "Listing available voices:"
            if ! kokoro-tts --help-voices 2>&1; then
                log "Warning: Failed to list voices with --help-voices. Trying alternative method..."
                if ! kokoro-tts --help 2>&1 | grep -A 20 "Supported voices:"; then
                    log "Error: Could not list voices. Check if kokoro-tts is properly installed."
                    log "Model files in $(dirname "$KOKORO_MODEL_PATH"):"
                    ls -la "$(dirname "$KOKORO_MODEL_PATH")" 2>/dev/null || true
                fi
            fi
        fi
    fi
    
    # Start the Python TTS service
    log "\n=== Starting Python TTS Service ==="
    cd /app
    
    # Set environment variables for the service
    export PYTHONUNBUFFERED=1
    export PYTHONPATH="/app"
    export PATH="/opt/venv/bin:$PATH"
    
    # Start the service in the background
    log "Starting uvicorn with: python -m uvicorn server.python_ws.main:app --host 0.0.0.0 --port 8899"
    cd /app  # Make sure we're in the app root
    
    # Debug: Show files in server/python-ws
    log "Contents of /app/server/python-ws:"
    ls -la /app/server/python-ws/ 2>&1 || log "Could not list /app/server/python-ws/"
    
    # Start the FastAPI app
    log "\n=== Starting Uvicorn Server ==="
    log "Command: python -m uvicorn app:app --host 0.0.0.0 --port 8899"
    
    # Start the server in the background and log output
    python -m uvicorn app:app --host 0.0.0.0 --port 8899 \
        --log-level debug \
        --log-config /dev/null \
        --no-access-log \
        &> /tmp/uvicorn.log &
    PYTHON_PID=$!
    
    # Give it a moment to start
    sleep 5
    
    # Check if the service is running and listening on the port
    if ! ps -p $! > /dev/null; then
        log "Error: Python TTS service failed to start"
        log "Uvicorn log output:"
        cat /tmp/uvicorn.log || true
        exit 1
    fi
    
    # Check if the service is responding
    if ! curl -s http://localhost:8899/health >/dev/null; then
        log "Error: Python TTS service is not responding"
        log "Uvicorn log output:"
        cat /tmp/uvicorn.log || true
        exit 1
    fi
    
    log "Python TTS service started successfully"
    
    # Check if the service is listening on the port
    check_service 8899 "Python TTS" "/docs" || { 
        log "Error: Python TTS service is not responding"; 
        kill $PYTHON_PID 2>/dev/null; 
        exit 1; 
    }

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

# Set Python TTS service directory
PYTHON_SERVICE_DIR="/app/python-tts"

export PYTHON_SERVICE_DIR
log "Using Python service directory: $PYTHON_SERVICE_DIR"

# Verify Python TTS service files exist
if [ ! -d "$PYTHON_SERVICE_DIR" ]; then
    log "Error: Python TTS service directory not found at $PYTHON_SERVICE_DIR"
    log "Contents of /app:"
    ls -la /app/ 2>&1 || true
    exit 1
fi

log "Python TTS service files:"
ls -la "$PYTHON_SERVICE_DIR" 2>&1 || true

# Start all services
start_services
