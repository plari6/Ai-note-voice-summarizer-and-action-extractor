FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production DATA_DIR=/data OUTPUT_DIR=/data/output
COPY package*.json ./
RUN npm ci --omit=dev
COPY bin ./bin
COPY src ./src
VOLUME /data
EXPOSE 3000
# Default: HTTP API + record page. For the bot: docker run ... voice-tasks telegram
ENTRYPOINT ["node", "bin/voice-tasks.js"]
CMD ["serve"]
