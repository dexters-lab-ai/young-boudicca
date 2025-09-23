#!/bin/sh
set -e

# Debug: Show environment and paths
echo "=== Environment ==="
printenv
echo "\n=== Python Info ==="
which python3 || echo "python3 not found"
/opt/venv/bin/python3 --version || echo "Could not get Python version from venv"
/opt/venv/bin/pip --version || echo "Could not get pip version from venv"

# Start the Python service in the background using the virtual environment's Python
echo "=== Starting Python TTS service ==="
/opt/venv/bin/python3 -m uvicorn server.python-ws.main:app --host 0.0.0.0 --port 8899 &

# Start the Node.js server in the background
echo "=== Starting Node.js server ==="
node server/index.js &

# Wait for services to be ready
echo "=== Waiting for services to be ready ==="
max_retries=30
count=0
while ! (nc -z localhost 3000 && nc -z localhost 8787 && nc -z localhost 8899); do
  if [ $count -ge $max_retries ]; then
    echo "Error: Services failed to start"
    exit 1
  fi
  echo "Waiting for services to be ready... (attempt $((count+1))/$max_retries)"
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
