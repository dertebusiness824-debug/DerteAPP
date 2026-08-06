# DerteApp — production image (Node 20 + Express + static PWA)
FROM node:20-bookworm-slim

WORKDIR /app

ENV NODE_ENV=production \
    PORT=3000

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY server ./server
COPY public ./public
COPY embed ./embed
COPY scripts ./scripts

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS "http://127.0.0.1:${PORT}/api/health" || exit 1

CMD ["node", "server/index.js"]
