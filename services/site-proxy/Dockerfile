# The website VM's sidecar (docs/deploy-site-vm.md). A static binary on distroless: nothing else
# in the image. Build from the repository root:
#   docker build -f services/site-proxy/Dockerfile -t cloudtrain/site-proxy:dev .
FROM golang:1.27.3-bookworm@sha256:dc0963f32053e4bc451d24d87e3892d42d01021b61f093e98eb95c0352bb84b0 AS build
WORKDIR /src
COPY services/site-proxy/ ./
RUN GOWORK=off CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/site-proxy ./cmd/site-proxy

FROM gcr.io/distroless/static-debian12:nonroot@sha256:afa5c872c891853ca7fcf1f12c3edb23f7eeef36189728842dd51042ff57f7ab
COPY --from=build /out/site-proxy /site-proxy
USER 65532:65532
ENTRYPOINT ["/site-proxy"]
