#!/bin/sh

# Start the Python service in the background
echo "Starting Python TTS service..."
/opt/venv/bin/uvicorn server.python-ws.main:app --host 0.0.0.0 --port 8899 &

# Wait for Python service to be ready
echo "Waiting for Python service to be ready..."
while ! nc -z localhost 8899; do
  sleep 0.5
done

# Start the Node.js backend
echo "Starting Node.js backend..."
cd /app && tsx server/index.ts &

# Start the Vite preview server
echo "Starting Vite preview server..."
cd /app && vite preview --host 0.0.0.0 --port 3000
