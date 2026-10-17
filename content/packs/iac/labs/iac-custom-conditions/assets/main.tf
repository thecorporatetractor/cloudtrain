terraform {
  required_providers {
    kubernetes = {
      source  = "hashicorp/kubernetes"
      version = "~> 3.3.0"
    }
    http = {
      source  = "hashicorp/http"
      version = "~> 3.6.0"
    }
  }
}

provider "kubernetes" {
  config_path    = "~/.kube/config"
  config_context = "sm-grid"
}

variable "namespace" {
  description = "Namespace the dashboard is deployed to"
  type        = string
  default     = "grid-dashboards"
}

variable "turbine_mw" {
  description = "Nameplate capacity in MW per turbine shown on the dashboard"
  type        = map(number)
  default = {
    "GH-01" = {{gh}}
    "RM-04" = 8.5
    "SK-02" = 14
  }
}

variable "service_type" {
  description = "Service type of the dashboard"
  type        = string
  default     = "ClusterIP"
}

variable "telemetry_url" {
  description = "Health endpoint of the telemetry gateway"
  type        = string
  default     = "http://127.0.0.1:9/healthz"
}

data "kubernetes_namespace_v1" "target" {
  metadata {
    name = var.namespace
  }
}

resource "kubernetes_config_map_v1" "capacities" {
  metadata {
    name      = "turbine-capacities"
    namespace = data.kubernetes_namespace_v1.target.metadata[0].name
  }
  data = { for id, mw in var.turbine_mw : id => tostring(mw) }
}

resource "kubernetes_service_v1" "dashboard" {
  metadata {
    name      = "dashboard"
    namespace = data.kubernetes_namespace_v1.target.metadata[0].name
  }
  spec {
    type = var.service_type
    selector = {
      app = "dashboard"
    }
    port {
      port        = 80
      target_port = 8080
    }
  }
}
