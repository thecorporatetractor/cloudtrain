variable "farm" {
  type = string
}

variable "turbines" {
  type = number
}

variable "namespace" {
  type = string
}

resource "kubernetes_config_map_v1" "settings" {
  metadata {
    name      = "farm-${var.farm}"
    namespace = var.namespace
    labels    = { "saltmarsh.example/farm" = var.farm }
  }
  data = {
    turbines = tostring(var.turbines)
  }
}

resource "kubernetes_service_account_v1" "agent" {
  metadata {
    name      = "${var.farm}-agent"
    namespace = var.namespace
    labels    = { "saltmarsh.example/farm" = var.farm }
  }
}

output "service_account" {
  value = kubernetes_service_account_v1.agent.metadata[0].name
}
