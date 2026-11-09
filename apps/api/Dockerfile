# Build once, promote the same image through dev -> staging -> prod (ARCH deployment).
# One image, two entry points: `node dist/main.web.js` (default) and `node dist/main.worker.js`.
FROM node:22-bookworm-slim AS build
WORKDIR /repo
RUN corepack enable
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY packages/contracts/package.json packages/contracts/
COPY apps/api/package.json apps/api/
RUN pnpm install --frozen-lockfile --filter @atp/api...
COPY packages/contracts packages/contracts
COPY apps/api apps/api
RUN pnpm --filter @atp/contracts build && pnpm --filter @atp/api build
RUN pnpm --filter @atp/api deploy --legacy --prod /out && cp -r apps/api/dist /out/dist

FROM node:22-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /out ./
USER node
EXPOSE 3001
CMD ["node", "dist/main.web.js"]
