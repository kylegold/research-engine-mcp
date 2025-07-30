# Multi-stage build for smaller image
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY tsconfig.json ./

# Install all dependencies (including dev)
RUN npm ci

# Copy source code
COPY src ./src
COPY mcp.yaml ./
COPY commands.yaml ./

# Build TypeScript
RUN npm run build

# Production stage
FROM node:20-alpine

RUN apk add --no-cache tini

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install only production dependencies
RUN npm ci --only=production && npm cache clean --force

# Copy built files from builder
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/mcp.yaml ./
COPY --from=builder /app/commands.yaml ./
COPY command-docs ./command-docs

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

USER nodejs

# Use tini for proper signal handling
ENTRYPOINT ["/sbin/tini", "--"]

# Default to running the MCP server
CMD ["node", "dist/index.js"]