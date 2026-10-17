resource "kubernetes_namespace_v1" "forecast" {
  metadata {
    name = "forecast-db"
  }
}

resource "random_password" "db" {
  length  = {{len}}
  special = false
}

resource "kubernetes_secret_v1" "db" {
  metadata {
    name      = "forecast-db-credentials"
    namespace = kubernetes_namespace_v1.forecast.metadata[0].name
  }
  data = {
    username = "forecast"
    password = random_password.db.result
  }
}
