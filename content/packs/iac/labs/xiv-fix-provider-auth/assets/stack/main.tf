resource "kubernetes_namespace_v1" "inland" {
  metadata {
    name = "inland-ops"
  }
}

resource "kubernetes_config_map_v1" "larkholt" {
  metadata {
    name      = "farm-larkholt"
    namespace = kubernetes_namespace_v1.inland.metadata[0].name
  }
  data = {
    turbines = "{{lt}}"
  }
}
