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

# Platform access (your kubeconfig): only used to obtain the deployer's credentials.
provider "kubernetes" {
  config_path    = "~/.kube/config"
  config_context = "sm-grid"
}

# The forecast deployer's long-lived token, read from its token Secret.
data "kubernetes_secret_v1" "deployer_token" {
  metadata {
    name      = "forecast-deployer-token"
    namespace = "forecast"
  }
}

# Everything the forecast stack deploys goes through the least-privileged deployer.
provider "kubernetes" {
  alias                  = "deployer"
  host                   = var.host
  cluster_ca_certificate = base64decode(var.ca_b64)
  token                  = data.kubernetes_secret_v1.deployer_token.data["token"]
}

resource "kubernetes_config_map_v1" "forecast" {
  provider = kubernetes.deployer

  metadata {
    name      = "forecast-settings"
    namespace = "forecast"
  }
  data = {
    horizon_hours = "{{horizon}}"
  }
}
