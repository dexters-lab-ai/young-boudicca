# ---- Dependencies Stage ----
FROM node:20-alpine AS deps

# Install build dependencies
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

# Copy package files first for better caching
COPY package*.json ./

# Clean npm cache and remove package-lock.json if exists
RUN npm cache clean --force && \
    rm -f package-lock.json && \
    rm -rf node_modules

# Install all dependencies including devDependencies for building
RUN npm install --legacy-peer-deps

# ---- Build Stage ----
FROM deps AS build

WORKDIR /app

# Copy all files from deps stage
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/package*.json ./

# Copy the rest of the source code
COPY . .

# Set the Vite base URL
ENV VITE_BASE_URL=/

# Install Vite as a dev dependency
RUN npm install --save-dev vite@latest

# Build the Vite frontend using production config
RUN npx vite build --emptyOutDir --config vite.prod.config.ts

# ---- Production Stage - Final image ----
FROM node:20-alpine AS production
ENV NODE_ENV=production

# Install runtime dependencies
RUN apk add --no-cache \
    libusb \
    udev \
    curl \
    && rm -rf /var/cache/apk/*

# Set up USB permissions
RUN echo 'SUBSYSTEM=="usb", MODE="0666"' > /etc/udev/rules.d/50-usb-permissions.rules

WORKDIR /app

# Install PM2 globally
RUN npm install -g pm2

# Copy package files and install production dependencies
COPY --from=build /app/package*.json ./
RUN npm ci --omit=dev --legacy-peer-deps

# Install Vite as a production dependency
RUN npm install vite@latest

# Create necessary directories
RUN mkdir -p /app/dist /app/public /app/server

# Copy built files from build stage
COPY --from=build /app/dist ./dist
COPY --from=build /app/public ./public
COPY --from=build /app/server ./server
COPY --from=build /app/ecosystem.config.js .
COPY --from=build /app/tsconfig.json .

# Ensure the index.html is in the correct location
RUN if [ ! -f "/app/dist/index.html" ]; then \
      echo "Error: index.html not found in /app/dist" && \
      ls -la /app/dist/; \
      exit 1; \
    fi

# Expose the ports for the frontend and backend
EXPOSE 3000 8787

# Healthcheck to ensure the frontend is responsive
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s \
  CMD curl -f http://localhost:3000/ || exit 1

# Start both backend and frontend using PM2
CMD ["pm2-runtime", "start", "ecosystem.config.js"]