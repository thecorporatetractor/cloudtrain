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

resource "kubernetes_namespace_v1" "inland" {
  metadata {
    name = "inland"
  }
}

resource "kubernetes_config_map_v1" "sites" {
  metadata {
    name      = "inland-sites"
    namespace = kubernetes_namespace_v1.inland.metadata[0].name
  }
  data = {
    sites    = "fenwick,larkholt"
    turbines = "{{turbines}}"
  }
}
