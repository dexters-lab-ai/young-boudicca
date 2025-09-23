#!/bin/sh
set -e

# Function to check if a service is running
wait_for_service() {
  host=$1
  port=$2
  timeout=30
  
  echo "Waiting for $host:$port..."
  for i in $(seq 1 $timeout); do
    if nc -z $host $port >/dev/null 2>&1; then
      echo "$host:$port is available"
      return 0
    fi
    sleep 1
  done
  echo "Timeout waiting for $host:$port"
  return 1
}

# Start the Python TTS service
echo "Starting Python TTS service..."
cd /app/server/python-ws
/opt/venv/bin/uvicorn main:app --host 0.0.0.0 --port 8899 &

# Wait for Python service to be ready
wait_for_service localhost 8899 || exit 1

# Start the Node.js backend
echo "Starting Node.js backend..."
cd /app
tsx server/index.ts &

# Wait for backend to be ready
wait_for_service localhost 8787 || exit 1

# Start the Vite preview server
echo "Starting Vite preview server..."
vite preview --host 0.0.0.0 --port 3000
