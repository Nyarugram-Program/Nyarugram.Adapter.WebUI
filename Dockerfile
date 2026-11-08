# syntax=docker/dockerfile:1
FROM node:22-alpine AS build
WORKDIR /app
ENV HUSKY=0
COPY package.json package-lock.json .npmrc ./
RUN npm ci
COPY index.html vite.config.ts tsconfig.json tsconfig.node.json postcss.config.js tailwind.config.js ./
COPY src ./src
COPY public ./public
RUN npm run webui:build

FROM nginxinc/nginx-unprivileged:stable-alpine AS runtime
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY LICENSE /usr/share/licenses/nyarugram-adapter-webui/LICENSE
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD wget -q -O /dev/null http://127.0.0.1:8080/healthz || exit 1
