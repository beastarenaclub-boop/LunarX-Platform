FROM node:22-bookworm-slim AS build
RUN corepack enable && corepack prepare pnpm@12.6.0 --activate
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json tsconfig.base.json ./
COPY lib ./lib
COPY artifacts/agent-panel ./artifacts/agent-panel
RUN pnpm install --frozen-lockfile --ignore-scripts
RUN pnpm --filter @workspace/agent-panel build
FROM nginx:1.27-alpine
COPY artifacts/agent-panel/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/artifacts/agent-panel/dist/public /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
