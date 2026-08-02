# syntax=docker/dockerfile:1
FROM oven/bun:1-alpine AS base
WORKDIR /app

# Install dependencies
COPY package.json ./
RUN bun install --production

# Copy source
COPY src/ ./src/
COPY tsconfig.json ./

# Run
EXPOSE 3001
ENV NODE_ENV=production
CMD ["bun", "run", "src/index.ts"]
