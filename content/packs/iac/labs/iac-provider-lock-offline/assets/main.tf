# Grid telemetry: collector namespace with a random suffix for the ingest token name.
provider "kubernetes" {
  config_path    = "~/.kube/config"
  config_context = "sm-grid"
}

resource "random_pet" "ingest" {
  length = 2
}

resource "kubernetes_namespace_v1" "telemetry" {
  metadata {
    name = "grid-telemetry"
    labels = {
      "saltmarsh.example/ingest" = random_pet.ingest.id
    }
  }
}
