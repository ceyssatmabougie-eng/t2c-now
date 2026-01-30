# Dockerfile pour T2C Now - Fly.io
FROM node:20-slim AS builder

# Install dependencies for better-sqlite3
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files first (better caching)
COPY package.json ./
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/

# Install dependencies
RUN npm install --ignore-scripts
RUN cd apps/api && npm install
RUN cd apps/web && npm install

# Copy source code
COPY apps ./apps

# Build frontend and backend
RUN npm run build

# Production image
FROM node:20-slim

RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy everything needed
COPY --from=builder /app/package.json ./
COPY --from=builder /app/apps/api ./apps/api
COPY --from=builder /app/apps/web/dist ./apps/web/dist

# Install all dependencies (including tsx for init script)
RUN cd apps/api && npm install

# Create data directory
RUN mkdir -p /app/apps/api/data

# Expose port
ENV PORT=8080
ENV NODE_ENV=production
EXPOSE 8080

# Use npm start which runs init-and-start.ts (downloads GTFS if needed)
CMD ["npm", "start"]
