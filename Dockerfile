FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY src ./src
COPY web ./web
COPY scripts ./scripts
COPY data/curated.json ./data/curated.json
RUN mkdir -p /app/state && chown node:node /app/state
ENV NODE_ENV=production PORT=8080 DATA_DIR=/app/state
USER node
EXPOSE 8080
VOLUME ["/app/state"]
HEALTHCHECK --interval=60s --timeout=5s CMD wget -qO- http://127.0.0.1:8080/healthz >/dev/null || exit 1
CMD ["node", "src/server.mjs"]
