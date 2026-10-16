terraform {
  required_providers {
    kubernetes = {
      source  = "hashicorp/kubernetes"
      version = "~> 3.3.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.9.0"
    }
  }
}

provider "kubernetes" {
  config_path    = "~/.kube/config"
  config_context = "sm-grid"
}

resource "kubernetes_namespace_v1" "inland" {
  metadata {
    name = "inland-ops"
  }
}

resource "kubernetes_config_map_v1" "farm" {
  for_each = toset(["fenwick", "larkholt"])

  metadata {
    name      = "farm-${each.key}"
    namespace = kubernetes_namespace_v1.inland.metadata[0].name
  }
  data = {
    farm = each.key
  }
}

resource "random_id" "suffix" {
  byte_length = 3
}

resource "kubernetes_secret_v1" "scada" {
  metadata {
    name      = "scada-${random_id.suffix.hex}"
    namespace = kubernetes_namespace_v1.inland.metadata[0].name
  }
  data = {
    "api-token" = "sc-91d0a2-not-a-real-token"
    "{{key}}"   = "rotated-quarterly"
  }
}
