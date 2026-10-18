terraform {
  required_providers {
    kubernetes = {
      source  = "hashicorp/kubernetes"
      version = "~> 3.3.0"
    }
  }
}

# The inland stack deploys as ServiceAccount inland-sites/inland-deployer (see ~/.kube/inland.yaml).
provider "kubernetes" {
  config_path    = "~/.kube/inland.yaml"
  config_context = "inland"
}

resource "kubernetes_config_map_v1" "sites" {
  metadata {
    name      = "inland-sites"
    namespace = "inland-sites"
  }
  data = {
    sites    = "fenwick,larkholt"
    turbines = "SEED_TURBINES"
  }
}
