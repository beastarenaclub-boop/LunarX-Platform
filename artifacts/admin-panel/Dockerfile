FROM node:22-bookworm-slim AS build

RUN corepack enable
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json tsconfig.base.json ./
COPY lib ./lib
COPY artifacts/admin-panel ./artifacts/admin-panel

RUN pnpm install --frozen-lockfile --ignore-scripts
RUN pnpm --filter @workspace/admin-panel build

FROM nginx:1.27-alpine

COPY artifacts/admin-panel/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/artifacts/admin-panel/dist/public /usr/share/nginx/html

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
