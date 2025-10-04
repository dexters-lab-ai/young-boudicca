# ---- Base Stage for Dependencies ----
# Use Node.js 22 to match dependency requirements and fix EBADENGINE errors.
FROM node:22-alpine AS deps

# Install OS-level dependencies needed for native modules (like libusb)
RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    pkgconfig \
    udev \
    eudev-dev \
    libusb-dev

WORKDIR /app

# Copy package files first to leverage Docker's layer caching
COPY package*.json ./

# Install dependencies.
# --legacy-peer-deps: Resolves the ERESOLVE conflict with @coral-xyz/anchor.
# --ignore-scripts: Prevents the "prepare" script from running `npm run build` prematurely.
RUN npm install --legacy-peer-deps --ignore-scripts

# Copy the rest of the application source code
COPY . .


# ---- Build Stage ----
# This stage builds the frontend assets.
FROM deps AS build

WORKDIR /app

# Run the production build script from your package.json
# The NODE_ENV=production is included in the script in your package.json
RUN npm run build:prod


# ---- Production Stage ----
# This is the final, lean image that will run the application.
FROM node:22-alpine AS production

ENV NODE_ENV=production

# Install only the necessary runtime OS dependencies
RUN apk add --no-cache \
    libusb \
    udev \
    curl

WORKDIR /app

# Copy package files and install only production dependencies for a smaller image size.
COPY --from=deps /app/package*.json ./
RUN npm ci --omit=dev --legacy-peer-deps --ignore-scripts

# Copy the built frontend assets from the 'build' stage
COPY --from=build /app/dist ./dist

# Copy the server, public folder, and other necessary config files from the 'deps' stage
COPY --from=deps /app/server ./server
COPY --from=deps /app/public ./public
# Assuming these files exist based on your original Dockerfile attempt
COPY --from=deps /app/ecosystem.config.js .
COPY --from=deps /app/tsconfig.json .

# Expose the port your application will run on
EXPOSE 3000

# Start the application using pm2.
# We install pm2 via npm ci from your package.json, so no global install is needed.
# The command uses the local pm2 executable from node_modules.
CMD ["npx", "pm2-runtime", "ecosystem.config.js"]