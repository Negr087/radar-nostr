# Radar Nostr worker image. Build from the repo root (see worker/docker-compose.yml).
FROM node:22-alpine

WORKDIR /app

# Only the worker's dependency (NDK): drop the web app's (Next, React) to keep the image small.
COPY package.json package-lock.json ./
RUN npm pkg delete dependencies.next dependencies.react dependencies.react-dom \
  && npm install --omit=dev --no-audit --no-fund \
  && npm cache clean --force

COPY lib ./lib
COPY worker ./worker

ENV NODE_ENV=production
# Keeps the heap well under the container's 512 MB: the daily web of trust build peaks at
# ~300 MB if the heap may grow, but retains only ~15 MB, so it fits with a tighter heap.
ENV NODE_OPTIONS=--max-old-space-size=320
USER node
CMD ["node", "worker/index.js"]
