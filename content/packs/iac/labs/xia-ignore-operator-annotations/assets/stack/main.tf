resource "kubernetes_namespace_v1" "forecast" {
  metadata {
    name = "forecast-ops"
  }
}

resource "kubernetes_deployment_v1" "forecast" {
  metadata {
    name      = "forecast"
    namespace = kubernetes_namespace_v1.forecast.metadata[0].name
    annotations = {
      "saltmarsh.example/owner" = "forecast-team"
    }
  }
  spec {
    replicas = 1
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
