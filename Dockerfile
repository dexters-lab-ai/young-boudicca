# Build stage
FROM node:20-slim AS build

# Install build dependencies
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
    python3 \
    python3-venv \
    make \
    g++ \
    build-essential \
    linux-headers-generic \
    libudev-dev \
    libusb-1.0-0-dev \
    pkg-config \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Set Python environment variables
ENV npm_config_python=python3
ENV npm_config_build_from_source=true

# Create and activate virtual environment
RUN python3 -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

# Install node-gyp and required Python packages
RUN npm install -g node-gyp && \
    pip install --upgrade pip setuptools wheel

# Set working directory
WORKDIR /app

# Copy package files
COPY package.json package-lock.json tsconfig*.json ./

# Install Node.js dependencies
RUN npm ci --legacy-peer-deps --omit=optional && \
    npm install -D @rollup/rollup-linux-x64-musl

# Copy source code
COPY . .

# Build the application
RUN npm run build

# Production stage
FROM node:20-slim

# Install runtime dependencies
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
    libusb-1.0-0 \
    udev \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Set up udev rules if needed for USB devices
RUN echo 'SUBSYSTEM=="usb", MODE="0666"' > /etc/udev/rules.d/50-usb-permissions.rules

# Install PM2 globally
RUN npm install -g pm2

# Set working directory
WORKDIR /app

# Copy package files
COPY package.json package-lock.json ./

# Install production dependencies (excluding optional deps)
RUN npm ci --only=production --no-optional --legacy-peer-deps

# Copy built application from build stage
COPY --from=build /app/dist ./dist
COPY --from=build /app/public ./public
COPY --from=build /app/ecosystem.config.js ./

# Expose ports
EXPOSE 3000
EXPOSE 8787

# Set environment variables
ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0

# Health check
HEALTHCHECK --interval=30s --timeout=3s \
  CMD curl -f http://localhost:3000/ || exit 1

# Start the application
CMD ["pm2-runtime", "start", "ecosystem.config.js"]