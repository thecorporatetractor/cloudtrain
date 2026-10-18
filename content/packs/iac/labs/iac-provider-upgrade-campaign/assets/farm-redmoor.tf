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

resource "kubernetes_namespace" "farm" {
  metadata {
    name   = "farm-redmoor"
    labels = { "saltmarsh.example/farm" = "redmoor" }
  }
}

resource "kubernetes_service_account" "scada" {
  metadata {
    name      = "scada-agent"
    namespace = kubernetes_namespace.farm.metadata[0].name
  }
}
