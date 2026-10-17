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

locals {
  farms = {
    gullhaven = { max_pods = {{gh}} }
    redmoor   = { max_pods = 20 }
    skerrow   = { max_pods = 30 }
  }
}

resource "kubernetes_namespace_v1" "farm" {
  for_each = local.farms
  metadata {
    name = "farm-${each.key}"
  }
}

resource "kubernetes_resource_quota_v1" "farm" {
  for_each = local.farms
  metadata {
    name      = "farm-quota"
    namespace = kubernetes_namespace_v1.farm[each.key].metadata[0].name
  }
  spec {
    hard = {
      pods = each.value.max_pods
    }
  }
}

resource "kubernetes_config_map_v1" "farm" {
  for_each = local.farms
  metadata {
    name      = "farm-info"
    namespace = kubernetes_namespace_v1.farm[each.key].metadata[0].name
  }
  data = {
    farm = each.key
  }
}
