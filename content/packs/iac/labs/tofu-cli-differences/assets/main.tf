terraform {
  required_providers {
    kubernetes = {
      source  = "hashicorp/kubernetes"
      version = "~> 3.3.0"
    }
  }
}

# One provider configuration per inland farm. Each farm will get its own cluster;
# today all three point at sm-grid.
provider "kubernetes" {
  alias          = "fenwick"
  config_path    = "~/.kube/config"
  config_context = "sm-grid"
}

provider "kubernetes" {
  alias          = "larkholt"
  config_path    = "~/.kube/config"
  config_context = "sm-grid"
}

provider "kubernetes" {
  alias          = "hub"
  config_path    = "~/.kube/config"
  config_context = "sm-grid"
}

variable "maintenance" {
  description = "Publish the maintenance-window ConfigMap on the hub."
  type        = bool
  default     = true
}

variable "dashboard_image" {
  type = string
}

resource "kubernetes_config_map_v1" "fenwick" {
  provider = kubernetes.fenwick
  metadata {
    name      = "farm-status"
    namespace = "inland-fenwick"
  }
  data = {
    farm     = "fenwick"
    turbines = "{{ft}}"
  }
}

resource "kubernetes_config_map_v1" "larkholt" {
  provider = kubernetes.larkholt
  metadata {
    name      = "farm-status"
    namespace = "inland-larkholt"
  }
  data = {
    farm     = "larkholt"
    turbines = "{{lt}}"
  }
}

resource "kubernetes_config_map_v1" "hub" {
  provider = kubernetes.hub
  metadata {
    name      = "farm-status"
    namespace = "inland-hub"
  }
  data = {
    farm     = "hub"
    turbines = "0"
  }
}

resource "kubernetes_config_map_v1" "maintenance" {
  count    = var.maintenance ? 1 : 0
  provider = kubernetes.hub
  metadata {
    name      = "maintenance-window"
    namespace = "inland-hub"
  }
  data = {
    window = "{{window}}"
  }
}

resource "kubernetes_deployment_v1" "dashboard" {
  provider = kubernetes.hub
  metadata {
    name      = "inland-dashboard"
    namespace = "inland-hub"
  }
  spec {
    replicas = 1
    selector {
      match_labels = { app = "inland-dashboard" }
    }
    template {
      metadata {
        labels = { app = "inland-dashboard" }
      }
      spec {
        container {
          name  = "dashboard"
          image = var.dashboard_image
        }
      }
    }
  }
  wait_for_rollout = false
}
