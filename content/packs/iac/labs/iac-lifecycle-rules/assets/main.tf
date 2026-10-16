terraform {
  required_providers {
    kubernetes = {
      source  = "hashicorp/kubernetes"
      version = "~> 3.3.0"
    }
  }
}

provider "kubernetes" {
  config_path    = "~/.kube/config"
  config_context = "sm-grid"
}

variable "pricing" {
  description = "Pricing engine settings"
  type        = map(string)
  default = {
    currency = "GBP"
    spread   = "0.015"
  }
}

resource "kubernetes_namespace_v1" "trading" {
  metadata {
    name = "trading-desk"
    annotations = {
      "saltmarsh.example/owner" = "energy-trading"
    }
  }
}

# The name changes with the content, so every pricing change is a new ConfigMap.
resource "kubernetes_config_map_v1" "pricing" {
  metadata {
    name      = "pricing-${substr(sha1(jsonencode(var.pricing)), 0, 8)}"
    namespace = kubernetes_namespace_v1.trading.metadata[0].name
  }
  data = var.pricing
}

resource "kubernetes_deployment_v1" "pricing_engine" {
  metadata {
    name      = "pricing-engine"
    namespace = kubernetes_namespace_v1.trading.metadata[0].name
  }
  spec {
    replicas = 1
    selector {
      match_labels = {
        app = "pricing-engine"
      }
    }
    template {
      metadata {
        labels = {
          app = "pricing-engine"
        }
      }
      spec {
        termination_grace_period_seconds = 2
        container {
          name    = "engine"
          image   = "busybox:1.37"
          command = ["sh", "-c", "echo spread=$SPREAD; sleep 1d"]
          env_from {
            config_map_ref {
              name = kubernetes_config_map_v1.pricing.metadata[0].name
            }
          }
        }
      }
    }
  }
}
