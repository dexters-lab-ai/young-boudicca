#!/bin/sh
set -e

# Debug: Show environment and paths
echo "=== Environment ==="
printenv
echo "\n=== Python Info ==="
which python3 || echo "python3 not found"
which pip || echo "pip not found"
python3 --version || echo "Could not get Python version"
pip --version || echo "Could not get pip version"

# Start the Python service in the background with the virtual environment
echo "=== Starting Python TTS service ==="
. /opt/venv/bin/activate && \
python3 -m uvicorn server.python-ws.main:app --host 0.0.0.0 --port 8899 &

# Wait for Python service to be ready
echo "=== Waiting for Python service to be ready ==="
max_retries=30
count=0
while ! nc -z localhost 8899; do
  if [ $count -ge $max_retries ]; then
    echo "Error: Python service failed to start"
    exit 1
  fi
  count=$((count+1))
  sleep 1
done
echo "Python service is ready"

# Start the Node.js backend
echo "=== Starting Node.js backend ==="
cd /app
tsx server/index.ts &

# Start the Vite preview server
echo "=== Starting Vite preview server ==="
vite preview --host 0.0.0.0 --port 3000

# Keep the container running
wait
