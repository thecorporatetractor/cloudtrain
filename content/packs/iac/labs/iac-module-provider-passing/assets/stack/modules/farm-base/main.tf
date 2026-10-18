# farm-base: the operations namespace objects for a group of wind farms.
terraform {
  required_providers {
    kubernetes = {
      source  = "hashicorp/kubernetes"
      version = "~> 3.3.0"
    }
  }
}

# Copied in when the module only served the offshore cluster.
provider "kubernetes" {
  config_path    = "~/.kube/config"
  config_context = "sm-north-sea"
}

variable "region" {
  description = "offshore or inland"
  type        = string
}

variable "farms" {
  description = "Farm name => turbine count."
  type        = map(number)
}

resource "kubernetes_namespace_v1" "farms" {
  metadata {
    name   = "farms"
    labels = { "saltmarsh.example/region" = var.region }
  }
}

resource "kubernetes_config_map_v1" "farm" {
  for_each = var.farms
  metadata {
    name      = "farm-${each.key}"
    namespace = kubernetes_namespace_v1.farms.metadata[0].name
  }
  data = {
    region   = var.region
    turbines = tostring(each.value)
  }
}
