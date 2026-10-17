terraform {
  required_providers {
    kubernetes = {
      source  = "hashicorp/kubernetes"
      version = "~> 3.3.0"
    }
    helm = {
      source  = "hashicorp/helm"
      version = "~> 3.3.0"
    }
  }
}

provider "kubernetes" {
  config_path    = "~/.kube/config"
  config_context = "sm-grid"
}

provider "helm" {
  kubernetes = {
    config_path    = "~/.kube/config"
    config_context = "sm-grid"
  }
}

resource "kubernetes_namespace_v1" "telemetry" {
  metadata {
    name = "telemetry-collector"
  }
}

resource "kubernetes_secret_v1" "credentials" {
  metadata {
    name      = "collector-credentials"
    namespace = "telemetry-collector"
  }
  data = {
    "ingest-token" = "xia-{{token}}"
  }
}

resource "helm_release" "collector" {
  name      = "collector"
  chart     = "${path.module}/charts/collector"
  namespace = "telemetry-collector"
  wait      = true
  timeout   = 120

  set = [
    {
      name  = "credentialsSecret"
      value = "collector-credentials"
    },
  ]
}
