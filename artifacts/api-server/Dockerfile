FROM node:22-alpine

RUN corepack enable && corepack prepare pnpm@12.6.0 --activate
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json tsconfig.base.json ./
COPY lib ./lib
COPY artifacts/api-server ./artifacts/api-server
COPY artifacts/3d-game/wingo-server ./artifacts/3d-game/wingo-server

RUN pnpm install --frozen-lockfile --ignore-scripts
RUN pnpm --filter @workspace/api-server build

WORKDIR /app/artifacts/api-server
EXPOSE 4000
CMD ["sh", "-c", "pnpm --filter @workspace/db migrate && node dist/index.mjs"]
