resource "kubernetes_namespace_v1" "settings" {
  metadata {
    name = "farm-settings-ns"
  }
}

resource "kubernetes_config_map_v1" "cfg" {
  metadata {
    name      = "farm-settings"
    namespace = kubernetes_namespace_v1.settings.metadata[0].name
  }
  data = {
    cut_in_ms = "{{cutin}}"
  }
}
