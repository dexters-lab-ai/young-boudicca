# Build stage
FROM node:20-alpine AS build

# Install build dependencies including Python and build tools
RUN apk add --no-cache --update --virtual .gyp \
    python3 \
    make \
    g++ \
    && ln -sf python3 /usr/bin/python

# Set Python environment variables
ENV PYTHON=/usr/bin/python3
ENV PYTHONPATH=/usr/lib/python3.11/site-packages

# Rest of your Dockerfile remains the same...
WORKDIR /app
COPY package.json package-lock.json tsconfig*.json ./

# Install all dependencies including devDependencies
RUN npm ci --legacy-peer-deps

COPY . .

# Build the application
RUN npm run build

# Production stage
FROM node:20-alpine

# Install runtime dependencies
RUN apk add --no-cache --upgrade bash curl

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

# Start the application
CMD ["pm2-runtime", "start", "ecosystem.config.js"]