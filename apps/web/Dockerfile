# apps/web production image: the static build (real API mode) behind an
# unprivileged nginx. Build from the repository root:
#   docker build -f apps/web/Dockerfile -t cloudtrain/web:dev .
# Runtime settings come from the environment, rendered at start (no rebuild per
# environment): CT_API_BASE, CT_ENVIRONMENT, CT_CSP_{SCRIPT,CONNECT,IMG,FRAME}_SRC,
# CT_WEB_PORT. Read-only root filesystem: mount a writable /tmp.
FROM node:22-bookworm-slim@sha256:c3de60bf2f9dd0ac6370e6117950ff62d6e339527e7472301c9c78a017978392 AS build
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate
WORKDIR /src
COPY . .
RUN pnpm install --frozen-lockfile --filter web... \
 && VITE_API_MODE=real pnpm --filter web build

FROM nginxinc/nginx-unprivileged:1.30-alpine@sha256:782bb89768cc87b7f95c18b95baa1af250e5d451f26794f59363540161147c01
USER root
RUN rm -f /etc/nginx/conf.d/default.conf /usr/share/nginx/html/*
COPY apps/web/docker/nginx.conf /etc/nginx/nginx.conf
COPY apps/web/docker/security-headers.conf /etc/nginx/cloudtrain/security-headers.conf
COPY apps/web/docker/templates/ /etc/nginx/templates/
COPY --from=build /src/apps/web/dist/ /usr/share/nginx/html/
# The build's runtime-config.js holds dev defaults; the rendered one in /tmp is served instead.
RUN rm -f /usr/share/nginx/html/runtime-config.js
ENV CT_WEB_PORT=8080 CT_API_BASE="" CT_ENVIRONMENT="" \
    CT_CSP_SCRIPT_SRC="" CT_CSP_CONNECT_SRC="" CT_CSP_IMG_SRC="" CT_CSP_FRAME_SRC="" \
    NGINX_ENVSUBST_OUTPUT_DIR=/tmp NGINX_ENVSUBST_FILTER=^CT_
USER 101:101
EXPOSE 8080
