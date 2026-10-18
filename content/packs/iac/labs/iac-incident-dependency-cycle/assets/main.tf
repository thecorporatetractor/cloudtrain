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

resource "kubernetes_resource_quota_v1" "forecast" {
  metadata {
    name      = "forecast-quota"
    namespace = kubernetes_namespace_v1.forecast.metadata[0].name
  }
  spec {
    hard = { pods = "10" }
  }
}

resource "kubernetes_service_v1" "api" {
  metadata {
    name      = "forecast-api"
    namespace = kubernetes_namespace_v1.forecast.metadata[0].name
  }
  spec {
    selector = { app = "forecast-api" }
    port {
      port        = {{port}}
      target_port = 80
    }
  }

  # Refactor MR !412: "publish the Service only once the API is deployed".
  depends_on = [kubernetes_deployment_v1.api]
}

resource "kubernetes_config_map_v1" "endpoints" {
  metadata {
    name      = "forecast-endpoints"
    namespace = kubernetes_namespace_v1.forecast.metadata[0].name
  }
  data = {
    # The API puts its own address into the links it returns.
    FORECAST_PUBLIC_URL = "http://${kubernetes_service_v1.api.spec[0].cluster_ip}:{{port}}"
  }
}

resource "kubernetes_deployment_v1" "api" {
  metadata {
    name      = "forecast-api"
    namespace = kubernetes_namespace_v1.forecast.metadata[0].name
  }
  spec {
    replicas = 1
    selector {
      match_labels = { app = "forecast-api" }
    }
    template {
      metadata {
        labels = { app = "forecast-api" }
      }
      spec {
        container {
          name  = "api"
          image = "httpd:2.4-alpine"
          env_from {
            config_map_ref {
              name = kubernetes_config_map_v1.endpoints.metadata[0].name
            }
          }
        }
      }
    }
  }
  wait_for_rollout = false

  # Pods count against the quota, so it must exist first.
  depends_on = [kubernetes_resource_quota_v1.forecast]
}
