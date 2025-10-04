
# ---- Base Stage - Install build dependencies ----
FROM node:22-slim AS base

# Install build dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    pkg-config \
    libudev-dev \
    libusb-1.0-0-dev \
    && rm -rf /var/lib/apt/lists/*

# ---- Build Stage - Build the application ----
FROM base AS build
WORKDIR /app

# Copy package files first for better layer caching
COPY package*.json ./

# Install all dependencies including devDependencies
RUN npm ci --legacy-peer-deps

# Copy the rest of the source code
COPY . .

# Build the Vite frontend
RUN npm run build

# ---- Production Stage - Final image ----
FROM node:22-slim AS production
ENV NODE_ENV=production

# Install runtime dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    libusb-1.0-0 \
    udev \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Set up USB permissions
RUN echo 'SUBSYSTEM=="usb", MODE="0666"' > /etc/udev/rules.d/50-usb-permissions.rules

WORKDIR /app

# Install PM2 globally
RUN npm install -g pm2

# Copy package files
COPY package*.json ./

# Install production dependencies
RUN npm ci --omit=dev --legacy-peer-deps

# Install tsx for TypeScript execution
RUN npm install -g tsx

# Copy built files from build stage
COPY --from=build /app/dist ./dist
COPY --from=build /app/public ./public
COPY --from=build /app/server ./server
COPY --from=build /app/ecosystem.config.js .
COPY --from=build /app/tsconfig.json .

# Expose the ports for the frontend and backend
EXPOSE 3000 8787

# Healthcheck to ensure the frontend is responsive
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s \
  CMD curl -f http://localhost:3000/ || exit 1

# Start both backend and frontend using PM2
CMD ["pm2-runtime", "start", "ecosystem.config.js"]
