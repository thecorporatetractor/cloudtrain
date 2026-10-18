# farm-base: one namespace per wind farm with a ResourceQuota sized from its turbines.
# Sizing rule (capacity team, rev. 4): per turbine {{cpu}}m CPU and {{mem}}Mi memory
# requested, and one telemetry pod per turbine plus 2 for the farm gateway.
locals {
  cpu_millicores = var.turbines * {{cpu}}
  memory_mi      = var.turbines * {{mem}}
  pods           = var.turbines + 2
}

resource "kubernetes_namespace_v1" "farm" {
  metadata {
    name   = "farm-${var.farm}"
    labels = { "saltmarsh.example/farm" = var.farm }
  }
}

resource "kubernetes_resource_quota_v1" "farm" {
  metadata {
    name      = "farm-capacity"
    namespace = kubernetes_namespace_v1.farm.metadata[0].name
  }
  spec {
    hard = {
      "requests.cpu"    = "${local.cpu_millicores}m"
      "requests.memory" = "${local.memory_mi}Mi"
      "pods"            = tostring(local.pods)
    }
  }
}

resource "local_file" "summary" {
  filename = "${var.summary_dir}/${var.farm}.quota"
  content  = "cpu=${local.cpu_millicores}m memory=${local.memory_mi}Mi pods=${local.pods}\n"
}
