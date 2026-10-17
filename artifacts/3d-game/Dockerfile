FROM node:22-bookworm-slim AS build

RUN corepack enable && corepack prepare pnpm@12.6.0 --activate
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json tsconfig.base.json ./
COPY lib ./lib
COPY artifacts/3d-game ./artifacts/3d-game
COPY artifacts/horse-riding ./artifacts/horse-riding

RUN pnpm install --frozen-lockfile --ignore-scripts
RUN pnpm --filter @workspace/3d-game build
RUN pnpm --filter @workspace/horse-riding build

FROM nginx:1.27-alpine

COPY artifacts/3d-game/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/artifacts/3d-game/dist/public /usr/share/nginx/html
COPY --from=build /app/artifacts/horse-riding/dist/public /usr/share/nginx/html/horse-riding

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
