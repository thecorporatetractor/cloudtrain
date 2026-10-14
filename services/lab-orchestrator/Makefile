# lab-orchestrator build targets.
SHELL := /usr/bin/env bash
.SHELLFLAGS := -eu -o pipefail -c

CONTROLLER_GEN_VERSION ?= v0.18.0
LOCALBIN       ?= $(HOME)/.local/bin
CONTROLLER_GEN ?= $(shell command -v controller-gen 2>/dev/null || echo $(LOCALBIN)/controller-gen)
SCHEMA_SRC     := ../../packages/lab-schema/schema/lab.schema.json
SCHEMA_DST     := internal/labschema/lab.schema.json
CURRICULUM_SRC := ../../packages/lab-schema/schema/curriculum.schema.json
CURRICULUM_DST := internal/labschema/curriculum.schema.json
BIN            := bin

.PHONY: all generate schema deepcopy manifests fmt vet test build labctl manager samples clean controller-gen

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

controller-gen:
	@test -x "$(CONTROLLER_GEN)" || GOBIN=$(LOCALBIN) go install sigs.k8s.io/controller-tools/cmd/controller-gen@$(CONTROLLER_GEN_VERSION)

fmt:
	gofmt -l -w .

vet:
	go vet ./...

## test: unit tests (fake client; no cluster or network needed)
test: vet
	go test ./...

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
