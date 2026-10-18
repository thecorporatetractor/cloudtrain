# Tracking stack: the reviewed configuration for objects that were created by hand
# during the harbour cut-over. They are not in state yet.

resource "kubernetes_config_map_v1" "tracking" {
  metadata {
    name      = "tracking-settings"
    namespace = "tracking-cfg"
    labels = {
      "app.kubernetes.io/name"  = "tracking"
      "quillmoor.example/owner" = "harbour-ops"
    }
  }
  data = {
    TRACKING_REGION   = "{{region}}"
    POLL_INTERVAL_SEC = "{{poll}}"
  }
}

resource "kubernetes_service_v1" "tracking" {
  metadata {
    name      = "tracking-api"
    namespace = "tracking-cfg"
    labels = {
      "app.kubernetes.io/name" = "tracking"
      "quillmoor.example/tier" = "backend"
    }
  }
  spec {
    selector = { app = "tracking-api" }
    port {
      name        = "http"
      port        = 80
      target_port = "8080"
    }
  }
}
