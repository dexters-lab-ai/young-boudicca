# ---- Base Stage for Dependencies ----
# Use Node.js 22, which is compatible with your dependencies.
FROM node:22-alpine AS deps

# Install OS-level dependencies needed for native modules.
RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    pkgconfig \
    udev \
    eudev-dev \
    libusb-dev

WORKDIR /app

# Copy package files first to leverage Docker's layer caching.
COPY package*.json ./

# RUN the main installation first.
# --legacy-peer-deps: Solves the ERESOLVE conflict with @coral-xyz/anchor.
# --ignore-scripts: Prevents the "prepare" script from running the build prematurely.
RUN npm install --legacy-peer-deps --ignore-scripts

# CRITICAL FIX: Force-install the problematic native binary AFTER the main install.
# This ensures it is present and correctly linked just before the build stage.
# This is the key change that addresses the persistent "Cannot find module" error.
RUN npm install --legacy-peer-deps @rollup/rollup-linux-x64-musl

# Copy the rest of the application source code
COPY . .

# Install production dependencies and build the application
RUN npm run build:prod

# ---- Build Stage ----
# This stage builds the frontend assets. It inherits everything from the 'deps' stage.
FROM node:20-alpine AS build

WORKDIR /app

# Copy all source files
COPY . .

# Copy node_modules from deps stage
COPY --from=deps /app/node_modules ./node_modules

# Build the application
RUN npm run build

# ---- Production Stage ----
# This is the final, lean image that will run the application.
FROM node:20-alpine AS production

ENV NODE_ENV=production

WORKDIR /app

# Install runtime dependencies
RUN apk add --no-cache udev eudev

# Copy package files
COPY --from=deps /app/package*.json ./

# Install production dependencies
RUN npm install --omit=dev --legacy-peer-deps \
    && npm rebuild usb --update-binary \
    && npm cache clean --force

# Copy built files from build stage
COPY --from=build /app/dist ./dist
COPY --from=build /app/server ./server
COPY --from=build /app/public ./public

# Copy config files
COPY --from=build /app/ecosystem.config.cjs .
COPY --from=build /app/tsconfig.json .
COPY --from=build /app/tsconfig.node.json .
COPY --from=build /app/vite.config.ts .

# Create logs directory
RUN mkdir -p /app/logs

# Clean up
RUN apk del .build-deps || true \
    && rm -rf /tmp/* /var/cache/apk/* /root/.npm /root/.node-gyp

# Clean up build dependencies
RUN apk del .build-deps \
    && rm -rf /tmp/* /var/cache/apk/* /root/.npm /root/.node-gyp \
    && find / -name "*.pyc" -delete \
    && find / -name "*.o" -delete

# Ensure the logs directory exists
RUN mkdir -p /app/logs

# Expose the port your application will run on.
EXPOSE 3000

# List the contents of the dist directory for debugging
RUN echo "Contents of /app/dist:" && ls -la /app/dist

# Start the application using the local pm2 executable
CMD ["npm", "run", "start:pm2"]