variable "namespace" {
  description = "Namespace the dashboard settings are deployed to"
  type        = string
  default     = "dash-billed"
}

data "kubernetes_namespace_v1" "target" {
  metadata {
    name = var.namespace
  }
}

resource "kubernetes_config_map_v1" "dashboard" {
  metadata {
    name      = "dashboard-settings"
    namespace = data.kubernetes_namespace_v1.target.metadata[0].name
  }
  data = {
    refresh_seconds = "{{refresh}}"
  }
}
