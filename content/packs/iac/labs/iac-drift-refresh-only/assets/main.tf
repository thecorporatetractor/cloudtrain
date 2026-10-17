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

resource "kubernetes_namespace_v1" "forecast" {
  metadata {
    name = "forecast"
  }
}

resource "kubernetes_secret_v1" "model" {
  metadata {
    name      = "forecast-model"
    namespace = kubernetes_namespace_v1.forecast.metadata[0].name
  }
  data = {
    "model-version" = "{{model}}"
  }
}

resource "kubernetes_deployment_v1" "forecast" {
  metadata {
    name      = "forecast"
    namespace = kubernetes_namespace_v1.forecast.metadata[0].name
  }
  spec {
    replicas = 2
    selector {
      match_labels = {
        app = "forecast"
      }
    }
    template {
      metadata {
        labels = {
          app = "forecast"
        }
      }
      spec {
        termination_grace_period_seconds = 2
        container {
          name    = "forecast"
          image   = "busybox:1.37"
          command = ["sleep", "1d"]
        }
      }
    }
  }
}

resource "kubernetes_service_v1" "forecast" {
  metadata {
    name      = "forecast"
    namespace = kubernetes_namespace_v1.forecast.metadata[0].name
    labels = {
      tier = "api"
    }
  }
  spec {
    selector = {
      app = "forecast"
    }
    port {
      port        = 8080
      target_port = 8080
    }
  }
}
