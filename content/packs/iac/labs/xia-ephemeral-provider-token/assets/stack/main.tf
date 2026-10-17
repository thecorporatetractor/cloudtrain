terraform {
  required_providers {
    kubernetes = {
      source  = "hashicorp/kubernetes"
      version = "~> 3.3.0"
    }
  }
}

variable "cluster_host" {
  description = "API server of sm-grid"
  type        = string
}

variable "cluster_ca" {
  description = "CA bundle (PEM) of sm-grid"
  type        = string
}

variable "deploy_token" {
  description = "Token of the forecast deployer ServiceAccount"
  type        = string
  sensitive   = true
}

# The deployer authenticates with its own token, not with the kubeconfig.
provider "kubernetes" {
  host                   = var.cluster_host
  cluster_ca_certificate = var.cluster_ca
  token                  = var.deploy_token
}

resource "kubernetes_config_map_v1" "release" {
  metadata {
    name      = "forecast-release"
    namespace = "forecast-token"
  }
  data = {
    version = "2026.09"
  }
}
