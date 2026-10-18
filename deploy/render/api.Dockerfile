FROM node:22-bookworm-slim

RUN corepack enable && corepack prepare pnpm@12.6.0 --activate
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json tsconfig.base.json ./
COPY lib ./lib
COPY artifacts/api-server ./artifacts/api-server
COPY artifacts/3d-game/wingo-server ./artifacts/3d-game/wingo-server
COPY deploy/render/api-start.sh /usr/local/bin/lunarx-api-start
COPY deploy/render/download-geo.mjs /app/download-geo.mjs
RUN node /app/download-geo.mjs

RUN pnpm install --frozen-lockfile --ignore-scripts
RUN pnpm --filter @workspace/api-server build
RUN sed -i 's/\r$//' /usr/local/bin/lunarx-api-start && chmod 755 /usr/local/bin/lunarx-api-start

ENV NODE_ENV=production PORT=4000
WORKDIR /app/artifacts/api-server
EXPOSE 4000
CMD ["/usr/local/bin/lunarx-api-start"]
