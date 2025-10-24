FROM node:20-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./tsconfig.json
COPY src ./src
COPY public ./public

RUN npm run build

FROM node:20-alpine
WORKDIR /app

# Copy only runtime artifacts
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/public ./public

ENV NODE_ENV=production
ENV PORT=8081

EXPOSE 8081

CMD ["node", "dist/server.js"]