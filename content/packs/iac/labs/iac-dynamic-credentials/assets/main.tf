terraform {
  required_providers {
    kubernetes = {
      source  = "hashicorp/kubernetes"
      version = "~> 3.3.0"
    }
  }
}

variable "host" {
  description = "API server URL of sm-grid"
  type        = string
}

variable "ca_b64" {
  description = "Base64 CA bundle of sm-grid"
  type        = string
}

variable "deployer_token" {
  description = "Token of ServiceAccount telemetry/telemetry-deployer (copied from its token Secret in 2024)"
  type        = string
  sensitive   = true
}

# The telemetry stack deploys only as the least-privileged telemetry-deployer.
provider "kubernetes" {
  host                   = var.host
  cluster_ca_certificate = base64decode(var.ca_b64)
  token                  = var.deployer_token
}

resource "kubernetes_config_map_v1" "settings" {
  metadata {
    name      = "telemetry-settings"
    namespace = "telemetry"
  }
  data = {
    retention_days = "7"
  }
}
