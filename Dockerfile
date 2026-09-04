# Morrow Glance, self-hosted. Storage is SQLite in a volume; no external
# services. Build:  docker build -t morrow-glance .
# Run:    docker run -p 3000:3000 -v morrow-data:/data morrow-glance
FROM node:22-slim AS build
WORKDIR /app

# Dependencies first, so a code change does not reinstall them.
COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN MORROW_TARGET=node npm run build:node


FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0 \
    MORROW_SQLITE_PATH=/data/morrow.db

# The standalone bundle carries the dependencies it needs.
COPY --from=build /app/dist/standalone ./

# SQLite lives in a volume so the configuration survives a new image.
RUN mkdir -p /data && chown -R node:node /data
VOLUME /data
USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/config').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
