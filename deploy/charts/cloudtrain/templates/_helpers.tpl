{{/* Release-scoped base name. */}}
{{- define "ct.fullname" -}}
{{- if contains .Chart.Name .Release.Name -}}
{{- .Release.Name | trunc 50 | trimSuffix "-" -}}
{{- else -}}
{{- printf "%s-%s" .Release.Name .Chart.Name | trunc 50 | trimSuffix "-" -}}
{{- end -}}
{{- end -}}

{{- define "ct.labels" -}}
app.kubernetes.io/part-of: cloudtrain
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version }}
{{- end -}}

{{/* ct.selector <ctx> <component> */}}
{{- define "ct.selector" -}}
app.kubernetes.io/instance: {{ (index . 0).Release.Name }}
app.kubernetes.io/component: {{ index . 1 }}
{{- end -}}

{{/* ct.image <ctx> <component values> */}}
{{- define "ct.image" -}}
{{- $ctx := index . 0 -}}
{{- $c := index . 1 -}}
{{- $tag := $c.image.tag | default $ctx.Values.global.imageTag | default $ctx.Chart.AppVersion -}}
{{- printf "%s/%s:%s" (trimSuffix "/" $ctx.Values.global.imageRegistry) $c.image.repository $tag -}}
{{- end -}}

{{/* https://<host> unless TLS is off. */}}
{{- define "ct.publicUrl" -}}
{{- printf "%s://%s" (ternary "https" "http" .Values.tls.enabled) .Values.host -}}
{{- end -}}

{{- define "ct.gatewaySecret" -}}
{{- if .Values.gateway.existingSecret -}}
{{- .Values.gateway.existingSecret -}}
{{- else -}}
{{- printf "%s-gateway" (include "ct.fullname" .) -}}
{{- end -}}
{{- end -}}

{{- define "ct.pullSecrets" -}}
{{- with .Values.global.imagePullSecrets }}
imagePullSecrets:
{{- range . }}
  - name: {{ . }}
{{- end }}
{{- end }}
{{- end -}}

{{/* Pod and container security for every platform pod. */}}
{{- define "ct.podSecurity" -}}
securityContext:
  runAsNonRoot: true
  seccompProfile: {type: RuntimeDefault}
{{- end -}}
{{- define "ct.containerSecurity" -}}
securityContext:
  allowPrivilegeEscalation: false
  readOnlyRootFilesystem: true
  capabilities: {drop: [ALL]}
{{- end -}}

{{/* Checks that fail the render early with a readable message. */}}
{{- define "ct.validate" -}}
{{- if not (has .Values.exposure.type (list "ingress" "gatewayAPI" "none")) -}}
{{- fail "exposure.type must be ingress, gatewayAPI or none" -}}
{{- end -}}
{{- if not (has .Values.tls.mode (list "secret" "certManager" "external")) -}}
{{- fail "tls.mode must be secret, certManager or external" -}}
{{- end -}}
{{- if and .Values.gateway.enabled (not .Values.gateway.existingSecret) (not .Values.gateway.secrets.create) -}}
{{- fail "gateway: set gateway.existingSecret (or gateway.secrets.create for demos)" -}}
{{- end -}}
{{- if and .Values.gateway.enabled (not .Values.gateway.oidc.issuer) -}}
{{- fail "gateway.oidc.issuer is required (the IdP's issuer URL)" -}}
{{- end -}}
{{- if and (eq .Values.exposure.type "gatewayAPI") (not .Values.exposure.gatewayAPI.createGateway) (not .Values.exposure.gatewayAPI.parentRefs) -}}
{{- fail "exposure.gatewayAPI: set parentRefs or createGateway" -}}
{{- end -}}
{{- end -}}

{{/* Database env of the gateway (and its migrate init container). */}}
{{- define "ct.gatewayDbEnv" -}}
{{- if .Values.postgres.demo.enabled -}}
{{- $pg := printf "%s-postgres" (include "ct.fullname" .) -}}
- name: PG_APP_PASSWORD
  valueFrom: {secretKeyRef: {name: {{ $pg }}, key: app-password}}
- name: PG_OWNER_PASSWORD
  valueFrom: {secretKeyRef: {name: {{ $pg }}, key: owner-password}}
- name: CT_DATABASE_URL
  value: "postgres://cloudtrain_app:$(PG_APP_PASSWORD)@{{ $pg }}:5432/cloudtrain"
- name: CT_DATABASE_OWNER_URL
  value: "postgres://cloudtrain_owner:$(PG_OWNER_PASSWORD)@{{ $pg }}:5432/cloudtrain"
{{- else -}}
- name: CT_DATABASE_URL
  valueFrom: {secretKeyRef: {name: {{ include "ct.gatewaySecret" . }}, key: CT_DATABASE_URL}}
- name: CT_DATABASE_OWNER_URL
  valueFrom: {secretKeyRef: {name: {{ include "ct.gatewaySecret" . }}, key: CT_DATABASE_OWNER_URL, optional: true}}
{{- end -}}
{{- end -}}
