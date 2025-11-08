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

# Copy the rest of the application source code.
COPY . .

# ---- Build Stage ----
# This stage builds the frontend assets. It inherits everything from the 'deps' stage.
FROM deps AS build

WORKDIR /app

# Run the production build script. This will now finally succeed.
RUN npm run build:prod

# ---- Production Stage ----
# This is the final, lean image that will run the application.
FROM node:22-alpine AS production

ENV NODE_ENV=production

# Install only the necessary runtime OS dependencies.
RUN apk add --no-cache \
    libusb \
    udev \
    curl

WORKDIR /app

# Copy package files and install only PRODUCTION dependencies for a smaller image size.
# Using `npm install --omit=dev` is safer than `npm ci` if a lockfile isn't guaranteed.
COPY --from=deps /app/package*.json ./
# Install required runtime dependencies for TypeScript execution
# Install ts-node both globally and locally to ensure PM2 can find it
RUN npm install -g ts-node typescript && \
    npm install --omit=dev --legacy-peer-deps --ignore-scripts tsx @types/node ts-node

# Copy the built frontend assets from the 'build' stage.
COPY --from=build /app/dist ./dist

# Copy the server, public folder, and other necessary config files from the 'deps' stage.
COPY --from=deps /app/server ./server
COPY --from=deps /app/public ./public
COPY --from=deps /app/ecosystem.config.cjs .
COPY --from=deps /app/tsconfig.json .

# Ensure the logs directory exists
RUN mkdir -p /app/logs

# Expose the port your application will run on.
EXPOSE 3000

# List the contents of the dist directory for debugging
RUN echo "Contents of /app/dist:" && ls -la /app/dist

# Start the application using the local pm2 executable
CMD ["npm", "run", "start:pm2"]