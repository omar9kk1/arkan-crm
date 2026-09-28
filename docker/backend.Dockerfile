FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
COPY apps/backend/package.json apps/backend/package.json
COPY apps/frontend/package.json apps/frontend/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN npm ci
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/backend apps/backend
RUN npm run build -w @arkan/shared && npm run db:generate && npm run build -w @arkan/backend
ENV NODE_ENV=production
USER node
WORKDIR /app/apps/backend
EXPOSE 4000
CMD ["node", "dist/main.js"]

