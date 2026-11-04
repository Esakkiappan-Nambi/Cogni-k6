# Node image
FROM node:20

# Working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci && chown -R node:node /app

# Copy remaining files
COPY --chown=node:node . .

# Expose Vite port
EXPOSE 5173

USER node

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:5173').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

# Start React app
CMD ["npm", "run", "dev", "--", "--host"]