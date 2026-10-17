variable "farm" {
  description = "Wind farm name"
  type        = string
}

variable "pod_quota" {
  description = "Maximum number of pods in the farm namespace"
  type        = number
}

resource "kubernetes_namespace_v1" "this" {
  metadata {
    name = "wf-${var.farm}"
  }
}

resource "kubernetes_resource_quota_v1" "this" {
  metadata {
    name      = "farm-quota"
    namespace = kubernetes_namespace_v1.this.metadata[0].name
  }
  spec {
    hard = {
      pods = var.pod_quota
    }
  }
}

output "namespace" {
  description = "Name of the farm namespace"
  value       = kubernetes_namespace_v1.this.metadata[0].name
}
