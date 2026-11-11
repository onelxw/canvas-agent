# 构建 Vite 前端产物。
FROM oven/bun:1.3.13 AS web-build

WORKDIR /app/web
COPY web/package.json web/bun.lock ./
RUN --mount=type=cache,target=/root/.bun/install/cache bun install --cache-dir=/root/.bun/install/cache
COPY VERSION /app/VERSION
COPY CHANGELOG.md /app/CHANGELOG.md
COPY web ./
RUN bun run build

# 运行镜像：Nginx 提供静态前端，并通过 Docker 内网转发同源 AI 请求。
FROM nginx:1.27-alpine

COPY --from=web-build /app/web/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/canvas.conf.template
COPY web/docker-entrypoint.sh /docker-entrypoint.d/40-runtime-config.sh
# Windows checkouts may send CRLF scripts into the Docker build context. Normalize
# the entrypoint inside the Linux image so /bin/sh can always execute it.
RUN sed -i 's/\r$//' /docker-entrypoint.d/40-runtime-config.sh \
    && chmod +x /docker-entrypoint.d/40-runtime-config.sh

EXPOSE 3000
