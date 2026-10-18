terraform {
  required_providers {
    kubernetes = {
      source  = "hashicorp/kubernetes"
      version = "~> 2.38.0"
    }
  }
}

provider "kubernetes" {
  config_path    = "~/.kube/config"
  config_context = "sm-grid"
}

variable "tier" {
  type    = string
  default = null
}

resource "kubernetes_namespace_v1" "ingest" {
  metadata {
    name = "grid-ingest"
    labels = {
      "saltmarsh.example/area" = "grid"
      "saltmarsh.example/tier" = var.tier
    }
  }
}

resource "kubernetes_config_map_v1" "pipeline" {
  metadata {
    name      = "pipeline"
    namespace = kubernetes_namespace_v1.ingest.metadata[0].name
  }
  data = {
    batch_seconds = "{{batch}}"
  }
}
