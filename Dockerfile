# Build stage
FROM node:20-alpine AS build

# Install build dependencies including Python and build tools
RUN apk add --no-cache --update --virtual .gyp \
    python3 \
    make \
    g++ \
    && ln -sf python3 /usr/bin/python \
    && ln -sf /usr/bin/python3 /usr/bin/python3.11

# Set Python environment variables
ENV PYTHON=/usr/bin/python3
ENV PYTHONPATH=/usr/lib/python3.11/site-packages
ENV npm_config_python=/usr/bin/python3
ENV npm_python=/usr/bin/python3

WORKDIR /app
COPY package.json package-lock.json tsconfig*.json ./

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
    # Required for node-gyp
    libc6-compat \
    # Install node-gyp globally
    && npm install -g node-gyp \
    # Configure npm to skip optional deps and use legacy peer deps
    && npm config set optional false \
    && npm config set legacy-peer-deps true \
    # Install dependencies
    && npm ci --legacy-peer-deps \
    # Clean up
    && npm cache clean --force \
    && rm -rf /var/cache/apk/* /tmp/*

COPY . .

# Build the application
RUN npm run build

# Production stage
FROM node:20-alpine

# Install runtime dependencies
RUN apk add --no-cache --upgrade \
    bash \
    curl \
    udev \
    eudev \
    libusb \
    python3 \
    make \
    g++ \
    # Required for some native modules at runtime
    libgcc \
    libstdc++ \
    && rm -rf /var/cache/apk/*

# Install PM2 globally
RUN npm install -g pm2

# Set working directory
WORKDIR /app

# Copy package files
COPY package.json package-lock.json ./

# Install production dependencies only
RUN npm ci --only=production --no-optional --legacy-peer-deps

# Copy built files from build stage
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