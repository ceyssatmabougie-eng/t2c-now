# Dockerfile pour T2C Now - Fly.io
FROM node:20-slim

# Install dependencies for better-sqlite3
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY apps/api/package*.json ./apps/api/
COPY apps/web/package*.json ./apps/web/

# Install dependencies
RUN npm install
RUN npm --prefix apps/api install
RUN npm --prefix apps/web install

# Copy source code
COPY . .

# Build frontend and backend
RUN npm run build

# Expose port
EXPOSE 8080

# Start the server
CMD ["npm", "start"]
