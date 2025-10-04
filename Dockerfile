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
# Install tsx as a production dependency since we need it to run TypeScript files
RUN npm install --omit=dev --legacy-peer-deps --ignore-scripts tsx

# Copy the built frontend assets from the 'build' stage.
COPY --from=build /app/dist ./dist

# Copy the server, public folder, and other necessary config files from the 'deps' stage.
COPY --from=deps /app/server ./server
COPY --from=deps /app/public ./public
COPY --from=deps /app/ecosystem.config.cjs .
COPY --from=deps /app/tsconfig.json .

# Expose the port your application will run on.
EXPOSE 3000

# List the contents of the dist directory for debugging
RUN echo "Contents of /app/dist:" && ls -la /app/dist

# Start the application using the local pm2 executable
CMD ["npm", "run", "start:pm2"]