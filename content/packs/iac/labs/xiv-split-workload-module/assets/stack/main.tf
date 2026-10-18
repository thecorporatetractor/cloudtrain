resource "kubernetes_deployment_v1" "forecast" {
  metadata {
    name      = "forecast"
    namespace = "forecast-svc"
    labels    = { app = "forecast" }
  }
  spec {
    replicas = {{replicas}}
    selector {
      match_labels = { app = "forecast" }
    }
    template {
      metadata {
        labels = { app = "forecast" }
      }
      spec {
        container {
          name  = "forecast"
          image = "httpd:2.4-alpine"
          port {
            container_port = 80
          }
        }
      }
    }
  }
  wait_for_rollout = false
}

resource "kubernetes_service_v1" "forecast" {
  metadata {
    name      = "forecast"
    namespace = "forecast-svc"
  }
  spec {
    selector = { app = "forecast" }
    port {
      port        = {{port}}
      target_port = 80
    }
  }
}

resource "kubernetes_horizontal_pod_autoscaler_v2" "forecast" {
  metadata {
    name      = "forecast"
    namespace = "forecast-svc"
  }
  spec {
    min_replicas = {{replicas}}
    max_replicas = {{maxr}}
    scale_target_ref {
      api_version = "apps/v1"
      kind        = "Deployment"
      name        = kubernetes_deployment_v1.forecast.metadata[0].name
    }
    metric {
      type = "Resource"
      resource {
        name = "cpu"
        target {
          type                = "Utilization"
          average_utilization = 70
        }
      }
    }
  }
}
