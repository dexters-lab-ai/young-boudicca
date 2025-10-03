######## Build stage: install deps and build client ########
FROM node:20-alpine AS build

WORKDIR /app

# Copy package files first for better caching
COPY package.json package-lock.json tsconfig*.json ./

# Install all dependencies including devDependencies
RUN npm ci --legacy-peer-deps

# Copy source code
COPY . .

# Build the application
RUN npm run build

######## Runtime stage: single Node service (API + static) ########
FROM node:20-alpine

WORKDIR /app

# Install runtime dependencies
RUN apk add --no-cache --upgrade bash curl

# Install PM2 globally for process management
RUN npm install -g pm2

# Copy package files
COPY package.json package-lock.json ./

# Install production dependencies only
RUN npm ci --only=production --legacy-peer-deps

# Copy built files from builder
COPY --from=build /app/dist ./dist
COPY --from=build /app/public ./public

# Copy the PM2 config
COPY ecosystem.config.js .

# Environment
ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0
EXPOSE 3000 8787

# Health check
HEALTHCHECK --interval=30s --timeout=3s \
  CMD curl -f http://localhost:3000/ || exit 1

# Start both services using PM2
CMD ["pm2-runtime", "start", "ecosystem.config.js"]