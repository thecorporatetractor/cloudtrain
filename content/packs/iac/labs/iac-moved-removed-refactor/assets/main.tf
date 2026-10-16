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

resource "kubernetes_namespace_v1" "ns1" {
  metadata {
    name = "telemetry-core"
  }
}

resource "kubernetes_config_map_v1" "cm" {
  metadata {
    name      = "collector-settings"
    namespace = kubernetes_namespace_v1.ns1.metadata[0].name
  }
  data = {
    flush_seconds = "{{flush}}"
  }
}

resource "kubernetes_namespace_v1" "old_archive" {
  metadata {
    name = "legacy-archive"
  }
}
