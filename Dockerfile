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
FROM deps AS build

WORKDIR /app

# Copy package files and install dependencies
COPY --from=deps /app/package*.json ./
RUN npm install --legacy-peer-deps

# Copy the rest of the application source code
COPY . .

# Run the production build script
RUN npm run build:prod


# ---- Production Stage ----
# This is the final, lean image that will run the application.
FROM node:22-alpine AS production

ENV NODE_ENV=production

# Install build dependencies
RUN apk add --no-cache --virtual .build-deps \
    python3 \
    make \
    g++ \
    pkgconfig \
    udev \
    eudev-dev \
    libusb-dev \
    linux-headers \
    bash \
    git \
    && npm install -g node-gyp@9.4.0 npm@10.2.0

WORKDIR /app

# Copy package files and install only PRODUCTION dependencies
COPY --from=build /app/package*.json ./

# Install production dependencies and handle usb module
RUN npm install --omit=dev --legacy-peer-deps \
    && npm rebuild usb --update-binary \
    && npm cache clean --force

# Copy the built frontend assets from the 'build' stage
COPY --from=build /app/dist ./dist

# Copy the server, public folder, and other necessary config files
COPY --from=build /app/server ./server
COPY --from=build /app/public ./public
COPY --from=build /app/ecosystem.config.cjs .
COPY --from=build /app/tsconfig.json .
COPY --from=build /app/tsconfig.node.json .

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