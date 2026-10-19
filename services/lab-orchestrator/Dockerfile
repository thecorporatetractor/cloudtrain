# lab-orchestrator manager image. Build from the repository root (it needs
# deploy/vcluster/values.yaml):
#   docker build -f services/lab-orchestrator/Dockerfile -t cloudtrain/lab-orchestrator:dev .
# Versions are pinned here by digest / sha256; VCLUSTER_VERSION matches deploy/versions.env.
FROM golang:1.27.2-bookworm@sha256:5cf287a799e6b94384bad13d16b14904c531f51ba65792237e122ce42b392f61 AS build
ARG HELM_VERSION=v3.22.0
ARG HELM_SHA256=1e4ab49e429626cf6c6958d914248b78c9730803c2751b87627e171dc800e7bb
ARG VCLUSTER_VERSION=0.37.2
ARG VCLUSTER_CHART_SHA256=0e3e1df3802a1199653930cfadcf52ba309ea7d5282a1a8541452bea8a9cf707
SHELL ["/bin/bash", "-o", "pipefail", "-c"]
WORKDIR /src
COPY services/lab-orchestrator/go.mod services/lab-orchestrator/go.sum ./
RUN GOWORK=off go mod download
COPY services/lab-orchestrator/ ./
RUN GOWORK=off CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/manager ./cmd/manager
RUN curl --retry 5 --retry-connrefused -fsSLo /tmp/helm.tgz "https://get.helm.sh/helm-${HELM_VERSION}-linux-amd64.tar.gz" \
 && echo "${HELM_SHA256}  /tmp/helm.tgz" | sha256sum -c - \
 && tar -xzf /tmp/helm.tgz -C /tmp && install -m 0755 /tmp/linux-amd64/helm /out/helm \
 && curl --retry 5 --retry-connrefused -fsSLo /out/vcluster.tgz "https://charts.loft.sh/charts/vcluster-${VCLUSTER_VERSION}.tgz" \
 && echo "${VCLUSTER_CHART_SHA256}  /out/vcluster.tgz" | sha256sum -c -

FROM gcr.io/distroless/static-debian12:nonroot@sha256:afa5c872c891853ca7fcf1f12c3edb23f7eeef36189728842dd51042ff57f7ab
COPY --from=build /out/manager /manager
COPY --from=build /out/helm /usr/local/bin/helm
COPY --from=build /out/vcluster.tgz /opt/cloudtrain/charts/vcluster.tgz
COPY deploy/vcluster/values.yaml /opt/cloudtrain/charts/vcluster-values.yaml
# helm needs writable cache/config dirs; /tmp is an emptyDir in the Deployment.
ENV HELM_CACHE_HOME=/tmp/helm/cache HELM_CONFIG_HOME=/tmp/helm/config HELM_DATA_HOME=/tmp/helm/data PATH=/usr/local/bin:/usr/bin:/bin
USER 65532:65532
ENTRYPOINT ["/manager"]
