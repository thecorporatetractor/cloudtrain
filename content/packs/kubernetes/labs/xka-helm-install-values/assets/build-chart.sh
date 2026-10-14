#!/bin/bash
# Builds the local chart repository ~/exam/charts with gate-metrics 0.4.2.
# Templates use <% %> (lab.yaml reserves double braces) and are converted here.
set -euo pipefail
src=$(mktemp -d); d=$src/gate-metrics
mkdir -p "$d/templates"
cat > "$d/Chart.yaml" <<'YAML'
apiVersion: v2
name: gate-metrics
description: Quillmoor gate throughput metrics
type: application
version: 0.4.2
appVersion: "2.4"
YAML
cat > "$d/values.yaml" <<'YAML'
replicaCount: 1
image:
  repository: httpd
  tag: 2.4-alpine
service:
  type: ClusterIP
  port: 80
YAML
cat > "$d/templates/deployment.yaml" <<'TPL'
apiVersion: apps/v1
kind: Deployment
metadata:
  name: <% .Release.Name %>-gate-metrics
  labels: {app.kubernetes.io/instance: <% .Release.Name %>, app.kubernetes.io/name: gate-metrics}
spec:
  replicas: <% .Values.replicaCount %>
  selector:
    matchLabels: {app.kubernetes.io/instance: <% .Release.Name %>, app.kubernetes.io/name: gate-metrics}
  template:
    metadata:
      labels: {app.kubernetes.io/instance: <% .Release.Name %>, app.kubernetes.io/name: gate-metrics}
    spec:
      containers:
        - name: metrics
          image: "<% .Values.image.repository %>:<% .Values.image.tag %>"
          ports: [{name: http, containerPort: 80}]
TPL
cat > "$d/templates/service.yaml" <<'TPL'
apiVersion: v1
kind: Service
metadata:
  name: <% .Release.Name %>-gate-metrics
spec:
  type: <% .Values.service.type %>
  selector: {app.kubernetes.io/instance: <% .Release.Name %>, app.kubernetes.io/name: gate-metrics}
  ports:
    - {name: http, port: <% .Values.service.port %>, targetPort: http}
TPL
find "$d" -type f -exec sed -i 's/<%/{{/g; s/%>/}}/g' {} +
mkdir -p "$HOME/exam/charts"
helm package "$d" -d "$HOME/exam/charts" >/dev/null
helm repo index "$HOME/exam/charts"
rm -rf "$src"
