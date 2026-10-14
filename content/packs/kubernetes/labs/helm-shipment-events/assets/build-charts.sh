#!/bin/bash
# Builds the depot's local chart repository in ~/charts: shipment-events 1.2.0 and 1.3.0.
# Templates are written with <% %> delimiters (lab.yaml reserves double braces for
# lab params) and converted to Go template delimiters here.
set -euo pipefail
src=$(mktemp -d)
mk() {  # mk <version> <appVersion> <extra values> <extra env>
  d=$src/$1/shipment-events
  mkdir -p "$d/templates"
  cat > "$d/Chart.yaml" <<YAML
apiVersion: v2
name: shipment-events
description: Quillmoor shipment event relay
type: application
version: $1
appVersion: "$2"
YAML
  cat > "$d/values.yaml" <<YAML
replicaCount: 1
image:
  repository: httpd
  tag: 2.4-alpine
service:
  type: ClusterIP
  port: 80
eventsSchema: "$3"
YAML
  cat > "$d/templates/_helpers.tpl" <<'TPL'
<%- define "se.labels" -%>
app.kubernetes.io/name: shipment-events
app.kubernetes.io/instance: <% .Release.Name %>
helm.sh/chart: <% .Chart.Name %>-<% .Chart.Version %>
<%- end %>
TPL
  cat > "$d/templates/deployment.yaml" <<'TPL'
apiVersion: apps/v1
kind: Deployment
metadata:
  name: <% .Release.Name %>
  labels:
    <%- include "se.labels" . | nindent 4 %>
spec:
  replicas: <% .Values.replicaCount %>
  selector:
    matchLabels:
      app.kubernetes.io/name: shipment-events
      app.kubernetes.io/instance: <% .Release.Name %>
  template:
    metadata:
      labels:
        <%- include "se.labels" . | nindent 8 %>
    spec:
      containers:
        - name: relay
          image: "<% .Values.image.repository %>:<% .Values.image.tag %>"
          env:
            - name: EVENTS_SCHEMA
              value: <% .Values.eventsSchema | quote %>
          ports:
            - name: http
              containerPort: 80
TPL
  cat > "$d/templates/service.yaml" <<'TPL'
apiVersion: v1
kind: Service
metadata:
  name: <% .Release.Name %>
  labels:
    <%- include "se.labels" . | nindent 4 %>
spec:
  type: <% .Values.service.type %>
  selector:
    app.kubernetes.io/name: shipment-events
    app.kubernetes.io/instance: <% .Release.Name %>
  ports:
    - name: http
      port: <% .Values.service.port %>
      targetPort: http
TPL
  find "$d" -type f -exec sed -i 's/<%/{{/g; s/%>/}}/g' {} +
}
mk 1.2.0 4.1.0 v1
mk 1.3.0 4.2.0 v2
mkdir -p "$HOME/charts"
helm package "$src/1.2.0/shipment-events" -d "$HOME/charts" >/dev/null
helm package "$src/1.3.0/shipment-events" -d "$HOME/charts" >/dev/null
helm repo index "$HOME/charts"
rm -rf "$src"
