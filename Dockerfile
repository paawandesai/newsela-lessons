# One image for every app; docker-compose picks the command.
FROM node:22-slim AS base
RUN corepack enable
WORKDIR /app

FROM base AS build
ARG NEXT_PUBLIC_COLLAB_URL=ws://localhost:1234
ENV NEXT_PUBLIC_COLLAB_URL=$NEXT_PUBLIC_COLLAB_URL
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY apps ./apps
COPY packages ./packages
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @nl/web build

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build /app /app
