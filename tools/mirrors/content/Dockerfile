# Mirror content image (MIRROR_CONTENT_IMAGE): the static dnf/apt/PyPI/Ansible snapshot
# built by tools/mirrors/build-content.sh, served read-only by unprivileged nginx on :8080.
ARG NGINX_IMAGE
FROM ${NGINX_IMAGE}
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --chown=101:101 content/ /usr/share/nginx/html/
