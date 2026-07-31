FROM node:22-alpine

# The agent shells out to nothing, but tar and curl help when debugging a node.
RUN apk add --no-cache tini curl

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY src ./src

ENV NODE_ENV=production
EXPOSE 8080

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "src/index.js"]
