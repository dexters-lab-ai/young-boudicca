# ---- Dependencies Stage ----
# Use Node.js 22 as required by dependencies to fix EBADENGINE warnings.
FROM node:22-alpine AS deps

# Install OS-level build dependencies
RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    pkgconfig \
    udev \
    eudev-dev \
    libusb-dev \
    && rm -rf /var/cache/apk/*

WORKDIR /app

# Copy package files first to leverage Docker cache
COPY package*.json ./

# Removing package-lock.json is not recommended for reproducible builds.
# This step ensures a clean slate, but consider using `npm ci` if a lockfile is available.
RUN npm cache clean --force && rm -f package-lock.json

# Explicitly install the native Rollup binary for Alpine Linux (musl).
# This is a common workaround for npm failing to install optional dependencies correctly.
RUN npm install --no-save @rollup/rollup-linux-x64-musl

# Install all project dependencies
RUN npm install --legacy-peer-deps

# Copy the rest of the application source code.
# This is done after npm install to optimize Docker's layer caching.
COPY . .

# ---- Build Stage ----
# Start a new stage from the same base image for a clean build environment
FROM node:22-alpine AS build
WORKDIR /app

# Copy all files from the 'deps' stage, including source code and node_modules
COPY --from=deps /app .

# Set the Vite base URL (if needed)
ENV VITE_BASE_URL=/

# Build the Vite frontend using the local vite executable
RUN npx vite build --emptyOutDir --config vite.prod.config.ts

# ---- Production Stage - Final image ----
# Use a slim, consistent base image for the final application
FROM node:22-alpine AS production
ENV NODE_ENV=production

# Install only runtime OS dependencies
RUN apk add --no-cache \
    libusb \
    udev \
    curl \
    && rm -rf /var/cache/apk/*

# Set up USB permissions (if required by the application)
RUN echo 'SUBSYSTEM=="usb", MODE="0666"' > /etc/udev/rules.d/50-usb-permissions.rules

WORKDIR /app

# Install PM2 globally to run the application
RUN npm install -g pm2

# Copy package files from the build stage to install only production dependencies
COPY --from=build /app/package*.json ./

# Install production dependencies using `npm ci` for faster, more reliable installs.
# This assumes a package-lock.json was generated during `npm install` in the 'deps' stage.
RUN npm ci --omit=dev --legacy-peer-deps

# The original Dockerfile installed Vite here. This is unusual for a production
# server unless you're using `vite preview`. I've kept it to match the original intent.
RUN npm install vite@latest

# Copy built application assets and other necessary files from the build stage
COPY --from=build /app/dist ./dist
COPY --from=build /app/public ./public
COPY --from=build /app/server ./server
COPY --from=build /app/ecosystem.config.js .
COPY --from=build /app/tsconfig.json .

# Verify the build output to fail fast if something went wrong
RUN if [ ! -f "/app/dist/index.html" ]; then \
        echo "Error: index.html not found in /app/dist" && \
        ls -la /app/dist/; \
        exit 1; \
    fi

# Expose the application port
EXPOSE 3000

# Start the application using PM2
CMD ["pm2-runtime", "ecosystem.config.js"]