variable "prefix" {
  description = "Name prefix of the forecast storage"
  type        = string
  default     = "{{prefix}}"
}

resource "kubernetes_namespace_v1" "forecast" {
  metadata {
    name = "forecast-wiring"
  }
}

module "storage" {
  source    = "./modules/storage"
  namespace = kubernetes_namespace_v1.forecast.metadata[0].name
  prefix    = var.prefix
}

module "workload" {
  source    = "./modules/workload"
  namespace = kubernetes_namespace_v1.forecast.metadata[0].name
}
