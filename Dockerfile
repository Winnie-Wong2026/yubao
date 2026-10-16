FROM node:20-bookworm-slim

WORKDIR /app

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8787 \
    TZ=Asia/Shanghai

COPY package.json ./
COPY server.mjs ./
COPY README.md ./
COPY assets ./assets
COPY product ./product
COPY vendor ./vendor

RUN mkdir -p /app/product/data /app/product/uploads \
  && chown -R node:node /app

USER node

EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8787/healthz').then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.mjs"]
