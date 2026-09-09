FROM node:24.18.0-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts

COPY . .

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=5178

EXPOSE 5178
VOLUME ["/app/work", "/app/outputs", "/app/data"]

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + (process.env.PORT || 5178) + '/api/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"]

CMD ["npm", "start"]
