
# ---- Build Stage ----
# Use Node.js 22 as recommended by dependency warnings in your logs.
FROM node:22-slim AS build

# Install build-time native dependencies for packages like 'usb'.
# This avoids bloating the final production image.
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    pkg-config \
    libudev-dev \
    libusb-1.0-0-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files and install all dependencies (including devDependencies) for the build.
COPY package.json package-lock.json ./
# Using --legacy-peer-deps as it was in the original setup
RUN npm ci --legacy-peer-deps

# Copy the rest of the source code
COPY . .

# Build the Vite frontend. The output will be in the /app/dist directory.
RUN npm run build


# ---- Production Stage ----
# Final, smaller image for deployment.
FROM node:22-slim AS production

ENV NODE_ENV=production

# Install only the runtime native dependencies required by your packages.
RUN apt-get update && apt-get install -y --no-install-recommends \
    libusb-1.0-0 \
    udev \
    curl \
    && rm -rf /var/lib/apt/lists/*

# This rule may be required for hardware wallet (e.g., Trezor) access if run in a privileged container.
RUN echo 'SUBSYSTEM=="usb", MODE="0666"' > /etc/udev/rules.d/50-usb-permissions.rules

WORKDIR /app

# Install PM2 to manage the processes.
RUN npm install -g pm2

# Copy package files.
COPY package.json package-lock.json ./

# Install only production dependencies.
# The --ignore-scripts flag is crucial to prevent the "prepare" script from running `vite build` again.
RUN npm ci --omit=dev --legacy-peer-deps --ignore-scripts

# Since `vite` is a devDependency but used by `ecosystem.config.js` to serve the frontend,
# we install it separately here. A better long-term solution would be to use a dedicated static file server.
RUN npm install vite

# Copy necessary application files from the build stage and the local context.
COPY --from=build /app/dist ./dist
COPY --from=build /app/public ./public
COPY --from=build /app/server ./server
COPY --from=build /app/ecosystem.config.js ./

# Expose the ports for the frontend preview server and the backend server.
EXPOSE 3000
EXPOSE 8787

# Healthcheck to ensure the frontend is responsive.
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s \
  CMD curl -f http://localhost:3000/ || exit 1

# Start both backend and frontend using PM2.
CMD ["pm2-runtime", "start", "ecosystem.config.js"]
