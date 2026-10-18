# services/gateway production image: the BFF (Node, compiled TypeScript), the Go
# lab compiler it shells out to (labctl compile / exam compile) and the lab
# content. Build from the repository root:
#   docker build -f services/gateway/Dockerfile -t cloudtrain/gateway:dev .
# Runs as non-root on a read-only root filesystem (mount a writable /tmp). In a
# pod it authenticates with its ServiceAccount (CT_KUBE_CONTEXT=in-cluster).
# Content can be replaced at runtime by mounting another directory and setting
# CT_CONTENT_DIR.
FROM golang:1.27.2-bookworm@sha256:5cf287a799e6b94384bad13d16b14904c531f51ba65792237e122ce42b392f61 AS labctl
WORKDIR /src
COPY services/lab-orchestrator/go.mod services/lab-orchestrator/go.sum ./
RUN GOWORK=off go mod download
COPY services/lab-orchestrator/ ./
RUN GOWORK=off CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/labctl ./cmd/labctl

FROM node:22-bookworm-slim@sha256:c3de60bf2f9dd0ac6370e6117950ff62d6e339527e7472301c9c78a017978392 AS build
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate
WORKDIR /src
COPY . .
RUN pnpm install --frozen-lockfile --filter @cloudtrain/gateway... \
 && pnpm --filter @cloudtrain/lab-schema build \
 && pnpm --filter @cloudtrain/gateway build \
 && pnpm --filter @cloudtrain/gateway deploy --prod /out/gateway

FROM gcr.io/distroless/nodejs22-debian13:nonroot@sha256:ec2313763dd43931543bd03830466e0c409ce73a487e8d46f10db72d3b816c1c
WORKDIR /opt/cloudtrain/gateway
COPY --from=build /out/gateway/ ./
COPY --from=labctl /out/labctl /usr/local/bin/labctl
COPY content/ /opt/cloudtrain/content/
ENV NODE_ENV=production \
    CT_HOST=0.0.0.0 \
    CT_PORT=8787 \
    CT_KUBE_CONTEXT=in-cluster \
    CT_CONTENT_DIR=/opt/cloudtrain/content \
    CT_LABCTL=/usr/local/bin/labctl
USER 65532:65532
EXPOSE 8787
# Entrypoint is node; `dist/db/cli.js migrate` runs the schema migrations (Helm hook).
CMD ["dist/main.js"]
