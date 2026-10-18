terraform {
  required_providers {
    kubernetes = {
      source  = "hashicorp/kubernetes"
      version = "~> 2.38.0"
    }
  }
}

provider "kubernetes" {
  config_path    = "~/.kube/config"
  config_context = "sm-grid"
}

variable "owner" {
  description = "Owning team label; not every farm has one yet."
  type        = string
  default     = null
}

resource "kubernetes_namespace" "farm" {
  metadata {
    name = "farm-gullhaven"
    labels = {
      "saltmarsh.example/farm"  = "gullhaven"
      "saltmarsh.example/owner" = var.owner
    }
  }
}

resource "kubernetes_config_map" "turbines" {
  metadata {
    name      = "turbines"
    namespace = kubernetes_namespace.farm.metadata[0].name
  }
  data = {
    count = "{{gt}}"
  }
}
