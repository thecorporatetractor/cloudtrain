terraform {
  required_providers {
    kubernetes = {
      source  = "hashicorp/kubernetes"
      version = "~> 3.3.0"
    }
    local = {
      source  = "hashicorp/local"
      version = "~> 2.9.0"
    }
  }
}
