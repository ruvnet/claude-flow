FROM node:22-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY src ./src
COPY ui ./ui
ENV PORT=8080 NODE_ENV=production RUFLO_AI_TEAM_STORE=firestore
EXPOSE 8080
USER node
CMD ["node", "src/server.mjs"]
