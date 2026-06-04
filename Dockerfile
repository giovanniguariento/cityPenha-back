# --- builder ---
FROM node:22-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci --ignore-scripts

COPY . .
RUN npx prisma generate
RUN npm run build

# --- production ---
FROM node:22-alpine

RUN apk add --no-cache tzdata

WORKDIR /app

ENV NODE_ENV=production
ENV TZ=America/Sao_Paulo

COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts \
    && npm install prisma@^7.2.0 --no-save

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/src/generated/prisma ./src/generated/prisma
COPY prisma ./prisma
COPY prisma.config.ts ./
COPY docker-entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

EXPOSE 3000

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "dist/server.js"]
