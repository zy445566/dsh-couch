# syntax=docker/dockerfile:1
FROM node:22-alpine AS runtime

WORKDIR /app
ENV NODE_ENV=production
RUN corepack enable

# Install only what the workspace manifests need; the relay itself is plain JS.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/protocol/package.json packages/protocol/
COPY packages/relay/package.json packages/relay/
COPY packages/dsh-couch/package.json packages/dsh-couch/
RUN pnpm install --frozen-lockfile --prod

COPY packages/protocol packages/protocol
COPY packages/relay packages/relay

RUN mkdir -p /data && chown -R node:node /data /app
USER node
EXPOSE 8787
CMD ["node", "packages/relay/bin/relay.js"]
