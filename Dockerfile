######## Build stage: install deps and build client ########
FROM node:20-alpine AS build

WORKDIR /app

# Install Python 3.10 and build tools
RUN apk add --no-cache python3=3.10.13-r0 py3-pip make g++ python3-dev=3.10.13-r0 gcc musl-dev libffi-dev openssl-dev

# Create and activate virtual environment
RUN python3 -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

# Install Python dependencies
COPY server/requirements.txt ./server/requirements.txt
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir -r ./server/requirements.txt

# Install Node.js dependencies
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# Copy source
COPY . .

# Build Vite client (server is run with tsx at runtime)
RUN npm run build

######## Runtime stage: single Node service (API + static) ########
FROM node:20-alpine AS runtime

# Install Python 3.10 and runtime dependencies
RUN apk add --no-cache python3=3.10.13-r0 py3-pip wget build-base
WORKDIR /app

# Copy node_modules from build stage (contains tsx)
COPY --from=build /app/node_modules ./node_modules

# Copy built client and server source
COPY --from=build /app/dist ./dist
COPY --from=build /app/server ./server
COPY --from=build /app/package.json ./

# Copy Python virtual environment from build stage
COPY --from=build /opt/venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

# Download Kokoro TTS models into the server directory
WORKDIR /app/server
RUN wget -q https://github.com/nazdridoy/kokoro-tts/releases/download/v1.0.0/voices-v1.0.bin && \
    wget -q https://github.com/nazdridoy/kokoro-tts/releases/download/v1.0.0/kokoro-v1.0.onnx

# Create python-tts directory and set permissions
WORKDIR /app/server/python-tts
RUN chmod -R 755 /app/server
WORKDIR /app


# Environment
ENV NODE_ENV=production
ENV PORT=8787

EXPOSE 8787

# Install curl for healthcheck
RUN apk add --no-cache curl

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS http://127.0.0.1:${PORT}/ >/dev/null || exit 1

# Start the TypeScript server with tsx (Node 20+)
CMD ["node", "--import", "tsx", "server/index.ts"]
