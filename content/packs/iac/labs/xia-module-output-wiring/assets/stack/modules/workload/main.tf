variable "namespace" {
  type = string
}

resource "kubernetes_deployment_v1" "forecast" {
  metadata {
    name      = "forecast"
    namespace = var.namespace
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
          volume_mount {
            name       = "data"
            mount_path = "/var/lib/forecast"
          }
        }
        volume {
          name = "data"
          persistent_volume_claim {
            claim_name = "forecast-scratch"
          }
        }
      }
    }
  }
  wait_for_rollout = false
}
