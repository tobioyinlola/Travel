FROM node:22-bookworm-slim AS build
WORKDIR /repo
RUN corepack enable
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY packages/api-client/package.json packages/api-client/
COPY frontend/package.json frontend/
RUN pnpm install --frozen-lockfile --filter @atp/web...
COPY packages/api-client packages/api-client
COPY frontend frontend
ARG NEXT_PUBLIC_API_BASE_URL
ENV NEXT_PUBLIC_API_BASE_URL=$NEXT_PUBLIC_API_BASE_URL
RUN pnpm --filter @atp/api-client build && pnpm --filter @atp/web build

FROM node:22-bookworm-slim
ENV NODE_ENV=production
# The app only needs `node`: drop the bundled package managers (a frequent source of scanner findings).
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /opt/yarn* /usr/local/bin/yarn /usr/local/bin/yarnpkg
WORKDIR /app
COPY --from=build /repo/frontend/.next/standalone ./
COPY --from=build /repo/frontend/.next/static ./frontend/.next/static
USER node
EXPOSE 3000
CMD ["node", "frontend/server.js"]
