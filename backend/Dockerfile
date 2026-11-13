# syntax=docker/dockerfile:1

# ---- build stage -----------------------------------------------------------
FROM node:22-alpine AS build

WORKDIR /app

# Install with the lockfile so image builds are reproducible.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# ---- runtime stage ---------------------------------------------------------
FROM node:22-alpine AS runtime

ENV NODE_ENV=production
WORKDIR /app

COPY --from=build /app/node_modules ./node_modules
COPY package.json ./
COPY server.js ./
COPY db.js ./
COPY db-postgres.js ./
COPY lib ./lib
COPY middleware ./middleware
COPY routes ./routes
COPY ecommerce-middleware ./ecommerce-middleware
COPY ecommerce-routes ./ecommerce-routes
COPY migrations ./migrations
COPY scripts ./scripts

# Uploads live on a volume so product images and receipts survive redeploys.
# Receipts are customer data: keep the volume private and backed up.
ENV UPLOAD_DIR=/data/uploads
RUN mkdir -p /data/uploads/receipts && chown -R node:node /data/uploads

USER node
EXPOSE 5000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||5000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
