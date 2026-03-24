FROM node:22-slim AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src/ src/
RUN npx tsc

FROM node:22-slim
RUN addgroup --system totem && adduser --system --ingroup totem totem
WORKDIR /app
COPY --from=builder /app/dist/ dist/
COPY --from=builder /app/node_modules/ node_modules/
COPY --from=builder /app/package.json ./
USER totem
ENV PORT=8080
EXPOSE 8080
CMD ["node", "dist/index.js"]
