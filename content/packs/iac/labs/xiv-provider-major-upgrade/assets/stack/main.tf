variable "on_call" {
  description = "On-call rota label; unset outside the storm season."
  type        = string
  default     = null
}

resource "kubernetes_namespace" "telemetry" {
  metadata {
    name = "telemetry-edge"
    labels = {
      "saltmarsh.example/team"    = "grid-telemetry"
      "saltmarsh.example/on-call" = var.on_call
    }
  }
}

resource "kubernetes_config_map" "collector" {
  metadata {
    name      = "edge-collector"
    namespace = kubernetes_namespace.telemetry.metadata[0].name
  }
  data = {
    flush_seconds = "{{flush}}"
  }
}
