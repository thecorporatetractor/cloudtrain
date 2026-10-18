# cloudtrain/oci-registry:3 - in-lab OCI registry (catalog oci-registry:3). Thin layer on the
# upstream CNCF Distribution registry:3 (3.1.2, DISTRIBUTION_VERSION in deploy/versions.env),
# pinned by multi-arch index digest. Alpine packages unpinned (Alpine drops superseded
# releases, so exact pins break rebuilds); images.yml gates on fixable CRITICALs.
#
# Defaults: plain HTTP on :5000, no auth, anonymous push and pull, storage under
# /var/lib/registry, deletes enabled, no debug/metrics listener. A lab turns on TLS or
# htpasswd with the upstream environment overrides, for example
#   REGISTRY_HTTP_TLS_CERTIFICATE / REGISTRY_HTTP_TLS_KEY
#   REGISTRY_AUTH=htpasswd REGISTRY_AUTH_HTPASSWD_REALM REGISTRY_AUTH_HTPASSWD_PATH
FROM registry:3@sha256:ddf754342cfc8acc51a56d5d0ab6af06826461864460636d8bd5c546dab2a7b8
RUN apk upgrade --no-cache \
 && printf 'cloudtrain/oci-registry:3 distribution=3.1.2\n' > /etc/cloudtrain-release
COPY config.yml /etc/distribution/config.yml
EXPOSE 5000
VOLUME /var/lib/registry
