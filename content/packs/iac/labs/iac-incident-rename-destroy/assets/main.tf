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

resource "kubernetes_namespace_v1" "trading" {
  metadata {
    name = "trading-desk"
  }
}

resource "kubernetes_persistent_volume_claim_v1" "db" {
  metadata {
    name      = "trading-ledger"
    namespace = kubernetes_namespace_v1.trading.metadata[0].name
    labels    = { "saltmarsh.example/data" = "ledger" }
  }
  spec {
    access_modes = ["ReadWriteOnce"]
    resources {
      requests = {
        storage = "{{size}}"
      }
    }
  }
  # The claim binds when the database Pod is scheduled (WaitForFirstConsumer).
  wait_until_bound = false
}

resource "kubernetes_config_map_v1" "db" {
  metadata {
    name      = "trading-ledger-db"
    namespace = kubernetes_namespace_v1.trading.metadata[0].name
  }
  data = {
    claim = kubernetes_persistent_volume_claim_v1.db.metadata[0].name
  }
}
