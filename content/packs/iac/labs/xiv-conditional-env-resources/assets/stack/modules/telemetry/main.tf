variable "env" {
  type = string
  validation {
    condition     = contains(["staging", "prod"], var.env)
    error_message = "env must be staging or prod."
  }
}

variable "replicas" {
  type = number
}

locals {
  namespace = "telemetry-${var.env}"
}

resource "kubernetes_namespace_v1" "this" {
  metadata {
    name   = local.namespace
    labels = { "saltmarsh.example/env" = var.env }
  }
}

resource "kubernetes_deployment_v1" "api" {
  metadata {
    name      = "telemetry-api"
    namespace = kubernetes_namespace_v1.this.metadata[0].name
  }
  spec {
    replicas = var.replicas
    selector {
      match_labels = { app = "telemetry-api" }
    }
    template {
      metadata {
        labels = { app = "telemetry-api" }
      }
      spec {
        container {
          name  = "api"
          image = "httpd:2.4-alpine"
        }
      }
    }
  }
  wait_for_rollout = false
}
