FROM node:22-bookworm-slim AS build

RUN corepack enable && corepack prepare pnpm@12.6.0 --activate
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json tsconfig.base.json ./
COPY lib ./lib
COPY artifacts/3d-game ./artifacts/3d-game
COPY artifacts/horse-riding ./artifacts/horse-riding
COPY artifacts/admin-panel ./artifacts/admin-panel
COPY artifacts/agent-panel ./artifacts/agent-panel
COPY deploy/render/prepare-nginx.mjs ./deploy/render/prepare-nginx.mjs

RUN pnpm install --frozen-lockfile --ignore-scripts
RUN VITE_B2C_HOSTS=crypto777.in,www.crypto777.in pnpm --filter @workspace/3d-game build
RUN pnpm --filter @workspace/horse-riding build
RUN VITE_B2C_SITE_URL=https://crypto777.in pnpm --filter @workspace/admin-panel build
RUN pnpm --filter @workspace/agent-panel build
RUN node deploy/render/prepare-nginx.mjs /tmp/lunarx.conf.template

FROM nginx:stable-alpine
COPY --from=build /app/artifacts/3d-game/dist/public /srv/lunarx/web
COPY --from=build /app/artifacts/horse-riding/dist/public /srv/lunarx/web/horse-riding
COPY --from=build /app/artifacts/admin-panel/dist/public /srv/lunarx/admin
COPY --from=build /app/artifacts/agent-panel/dist/public /srv/lunarx/operator
COPY --from=build /tmp/lunarx.conf.template /etc/nginx/templates/default.conf.template
COPY --chmod=755 deploy/render/19-api-resolvers.envsh /docker-entrypoint.d/19-api-resolvers.envsh

ENV PORT=10000 NGINX_ENVSUBST_FILTER="^(PORT|API_UPSTREAM|API_DNS_UPSTREAM|NGINX_RESOLVERS)$"
EXPOSE 10000
CMD ["nginx", "-g", "daemon off;"]
