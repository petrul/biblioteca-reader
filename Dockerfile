FROM node:24-slim AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# Vite inlines VITE_-prefixed env vars into the bundle at build time (see
# useGoogleIdentity in GoogleOneTap.tsx) - there's no way to set this at
# container runtime, it has to be here, passed through as a build-arg by
# whatever builds this image (see rakefile's docker:build task).
ARG VITE_GOOGLE_CLIENT_ID
ENV VITE_GOOGLE_CLIENT_ID=$VITE_GOOGLE_CLIENT_ID

RUN npm run build

FROM node:24-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY --from=build /app/dist ./dist

USER node
EXPOSE 3100
ENV PORT=3100

CMD ["node", "dist/server.cjs"]
