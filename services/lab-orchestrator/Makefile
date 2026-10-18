# lab-orchestrator build targets.
SHELL := /usr/bin/env bash
.SHELLFLAGS := -eu -o pipefail -c

CONTROLLER_GEN_VERSION ?= v0.22.0
LOCALBIN       ?= $(HOME)/.local/bin
# Versioned binary name so a different controller-gen on PATH never produces drift.
CONTROLLER_GEN ?= $(LOCALBIN)/controller-gen-$(CONTROLLER_GEN_VERSION)
SCHEMA_SRC     := ../../packages/lab-schema/schema/lab.schema.json
SCHEMA_DST     := internal/labschema/lab.schema.json
CURRICULUM_SRC := ../../packages/lab-schema/schema/curriculum.schema.json
CURRICULUM_DST := internal/labschema/curriculum.schema.json
BIN            := bin

.PHONY: all generate schema deepcopy manifests fmt vet test test-rbac build labctl manager samples clean controller-gen

all: generate build test

## generate: sync embedded schema, deepcopy, CRDs and RBAC
generate: schema deepcopy manifests

schema:
	cp $(SCHEMA_SRC) $(SCHEMA_DST)
	cp $(CURRICULUM_SRC) $(CURRICULUM_DST)

deepcopy: controller-gen
	$(CONTROLLER_GEN) object:headerFile=hack/boilerplate.go.txt paths=./api/...

manifests: controller-gen
	$(CONTROLLER_GEN) crd paths=./api/... output:crd:artifacts:config=config/crd
	$(CONTROLLER_GEN) rbac:roleName=lab-orchestrator paths=./internal/controller/... output:rbac:artifacts:config=config/rbac
	$(CONTROLLER_GEN) rbac:roleName=lab-orchestrator-session paths=./internal/rbac/... output:rbac:stdout > config/rbac/session_role.yaml

controller-gen:
	@test -x "$(CONTROLLER_GEN)" || { \
		tmp=$$(mktemp -d); \
		GOBIN=$$tmp go install sigs.k8s.io/controller-tools/cmd/controller-gen@$(CONTROLLER_GEN_VERSION); \
		mkdir -p "$$(dirname "$(CONTROLLER_GEN)")"; mv "$$tmp/controller-gen" "$(CONTROLLER_GEN)"; rmdir "$$tmp"; }

fmt:
	gofmt -l -w .

vet:
	go vet ./...

## test: unit tests (fake client; no cluster or network needed)
test: vet
	go test ./...

## test-rbac: the RBAC envtest (real API server: RBAC authorizer and the admission
## policy; downloads the envtest binaries into $(LOCALBIN)/envtest)
ENVTEST_K8S_VERSION    ?= 1.36.0
SETUP_ENVTEST_VERSION  ?= release-0.25
test-rbac:
	KUBEBUILDER_ASSETS="$$(go run sigs.k8s.io/controller-runtime/tools/setup-envtest@$(SETUP_ENVTEST_VERSION) use $(ENVTEST_K8S_VERSION) --bin-dir $(LOCALBIN)/envtest -p path)" \
		go test ./internal/rbac/ -run 'Envtest' -count=1 -v

## build: binaries into bin/
build: labctl manager

labctl:
	go build -o $(BIN)/labctl ./cmd/labctl

manager:
	go build -o $(BIN)/manager ./cmd/manager

## samples: compile the testdata labs with labctl
samples: labctl
	$(BIN)/labctl validate testdata/labs
	@for f in testdata/labs/*/lab.yaml; do echo "--- $$f"; $(BIN)/labctl compile --seed 1234 $$f >/dev/null && echo compiled; done

clean:
	rm -rf $(BIN)
