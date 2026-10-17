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

resource "kubernetes_namespace_v1" "db" {
  metadata {
    name = "telemetry-db"
  }
}

# A fresh password is generated on every run and never stored.
ephemeral "random_password" "db" {
  length  = 24
  special = false
}

resource "kubernetes_secret_v1" "db" {
  metadata {
    name      = "telemetry-db-credentials"
    namespace = kubernetes_namespace_v1.db.metadata[0].name
  }
  # data_wo cannot be combined with data, so the username travels write-only too.
  data_wo = {
    username = "{{user}}"
    password = ephemeral.random_password.db.result
  }
  data_wo_revision = 1
}
