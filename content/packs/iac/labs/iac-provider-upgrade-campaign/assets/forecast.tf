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

resource "kubernetes_namespace" "forecast" {
  metadata {
    name = "forecast"
  }
}

resource "kubernetes_resource_quota" "forecast" {
  metadata {
    name      = "forecast-quota"
    namespace = kubernetes_namespace.forecast.metadata[0].name
  }
  spec {
    hard = {
      pods = "{{pods}}"
    }
  }
}
