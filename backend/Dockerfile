# syntax=docker/dockerfile:1
FROM oven/bun:1-alpine AS base
WORKDIR /app

# Install Python + LibreOffice + font untuk PDF generation (cetak SPPD)
# Liberation = metric-compatible dgn Arial/Times New Roman/Courier
RUN apk add --no-cache python3 py3-pip libreoffice-writer ttf-liberation fontconfig \
    && pip3 install --break-system-packages docxtpl

# Install dependencies (produksi: tanpa devDependencies)
COPY package.json ./
RUN bun install --production

# Source + tooling migrasi + templates
# (File migrasi db/migrations/ tidak ikut image — di-mount sebagai volume
#  oleh service arthakarya_migrator di docker-compose.prod.yml)
COPY src/ ./src/
COPY scripts/ ./scripts/
COPY tsconfig.json ./

# Run
EXPOSE 3001
ENV NODE_ENV=production
CMD ["bun", "run", "src/index.ts"]
