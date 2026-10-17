variable "namespace" {
  type = string
}

variable "prefix" {
  type = string
}

resource "kubernetes_persistent_volume_claim_v1" "data" {
  metadata {
    name      = "${var.prefix}-data"
    namespace = var.namespace
  }
  spec {
    access_modes = ["ReadWriteOnce"]
    resources {
      requests = {
        storage = "1Gi"
      }
    }
  }
  wait_until_bound = false
}
