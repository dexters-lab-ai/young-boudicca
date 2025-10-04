# ---- Dependencies Stage ----
FROM node:22-slim AS deps

# Install build dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    pkg-config \
    libudev-dev \
    libusb-1.0-0-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install all dependencies including devDependencies for building
RUN npm ci --legacy-peer-deps

# Install Vite as a dev dependency
RUN npm install --save-dev vite@latest

# ---- Build Stage ----
FROM deps AS build

WORKDIR /app

# Copy all files from deps stage
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/package*.json ./

# Copy the rest of the source code
COPY . .

# Build the Vite frontend
RUN npx vite build

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

# Copy package files and install production dependencies including Vite
COPY --from=build /app/package*.json ./
RUN npm ci --omit=dev --legacy-peer-deps

# Ensure Vite is available in the final image
RUN npm install vite@latest

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