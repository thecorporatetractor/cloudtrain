variable "health_url" {
  description = "Health endpoint of the telemetry gateway"
  type        = string
  default     = "http://127.0.0.1:9/health"
}

resource "kubernetes_namespace_v1" "gateway" {
  metadata {
    name = "telemetry-gateway"
  }
}

resource "kubernetes_config_map_v1" "gateway" {
  metadata {
    name      = "gateway-settings"
    namespace = kubernetes_namespace_v1.gateway.metadata[0].name
  }
  data = {
    upstream = "{{upstream}}"
  }
}
