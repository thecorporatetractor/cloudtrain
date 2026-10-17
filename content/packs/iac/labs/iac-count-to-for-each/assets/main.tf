terraform {
  required_providers {
    kubernetes = {
      source  = "hashicorp/kubernetes"
      version = "~> 3.3.0"
    }
  }
}

provider "kubernetes" {
  config_path    = "~/.kube/config"
  config_context = "sm-grid"
}

variable "substations" {
  description = "Grid substations that get a telemetry namespace"
  type        = list(string)
  default     = ["north-quay", "saltings", "marsh-end", "harbour-gate"]
}

resource "kubernetes_namespace_v1" "substation" {
  count = length(var.substations)

  metadata {
    name = "substation-${var.substations[count.index]}"
    labels = {
      "saltmarsh.example/substation" = var.substations[count.index]
    }
  }
}
