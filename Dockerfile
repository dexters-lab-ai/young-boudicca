# Build stage
FROM node:20-alpine AS build

# Install build dependencies
RUN apk add --no-cache --update \
    python3 \
    make \
    g++ \
    linux-headers \
    udev \
    eudev-dev \
    libusb-dev \
    e2fsprogs-extra \
    libc6-compat \
    linux-lts-headers \
    util-linux-dev \
    && ln -sf python3 /usr/bin/python

# Set working directory
WORKDIR /app

# Copy package files
COPY package.json package-lock.json tsconfig*.json ./

# Install dependencies
RUN npm install -g node-gyp && \
    npm ci --legacy-peer-deps --omit=optional && \
    npm install -D @rollup/rollup-linux-x64-musl

# Copy source code
COPY . .

# Build the application
RUN npm run build

# Production stage - Using node:20-slim for better compatibility
FROM node:20-slim

# Install runtime dependencies
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
    libusb-1.0-0 \
    udev \
    curl \
    && rm -rf /var/lib/apt/lists/*

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