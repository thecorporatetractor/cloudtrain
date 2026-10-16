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

variable "grid_operator_token" {
  description = "API token of the grid operator's market feed"
  type        = string
  sensitive   = true
}

resource "kubernetes_namespace_v1" "feed" {
  metadata {
    name = "trading-feed"
  }
}

resource "kubernetes_secret_v1" "feed" {
  metadata {
    name      = "grid-operator"
    namespace = kubernetes_namespace_v1.feed.metadata[0].name
  }
  data = {
    token = var.grid_operator_token
  }
}
