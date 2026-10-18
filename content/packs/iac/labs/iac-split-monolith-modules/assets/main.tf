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

# grid-telemetry: one flat root module that grew to 31 objects.
locals {
  components = {
    collector = { port = 4317, clients = ["gateway"] }
    historian = { port = 5432, clients = ["collector", "forecast"] }
    alerting  = { port = 9093, clients = ["collector", "historian"] }
    forecast  = { port = 8080, clients = ["gateway"] }
    gateway   = { port = 8443, clients = [] }
  }
  credentials = toset(["historian", "alerting", "forecast"])
  stack_label = { "saltmarsh.example/stack" = "grid-telemetry" }
}

resource "kubernetes_namespace_v1" "grid" {
  metadata {
    name = "grid-telemetry"
  }
}

# --- network ---------------------------------------------------------------
resource "kubernetes_service_v1" "svc" {
  for_each = local.components
  metadata {
    name      = each.key
    namespace = kubernetes_namespace_v1.grid.metadata[0].name
    labels    = local.stack_label
  }
  spec {
    selector = { app = each.key }
    port {
      port        = each.value.port
      target_port = 80
    }
  }
}

resource "kubernetes_network_policy_v1" "default_deny" {
  metadata {
    name      = "default-deny"
    namespace = kubernetes_namespace_v1.grid.metadata[0].name
    labels    = local.stack_label
  }
  spec {
    pod_selector {}
    policy_types = ["Ingress"]
  }
}

resource "kubernetes_network_policy_v1" "allow" {
  for_each = local.components
  metadata {
    name      = "allow-${each.key}"
    namespace = kubernetes_namespace_v1.grid.metadata[0].name
    labels    = local.stack_label
  }
  spec {
    pod_selector {
      match_labels = { app = each.key }
    }
    policy_types = ["Ingress"]
    dynamic "ingress" {
      for_each = each.value.clients
      content {
        from {
          pod_selector {
            match_labels = { app = ingress.value }
          }
        }
        ports {
          port     = "80"
          protocol = "TCP"
        }
      }
    }
  }
}

# --- storage ---------------------------------------------------------------
resource "kubernetes_config_map_v1" "settings" {
  for_each = local.components
  metadata {
    name      = "${each.key}-settings"
    namespace = kubernetes_namespace_v1.grid.metadata[0].name
    labels    = local.stack_label
  }
  data = {
    COMPONENT = each.key
    PORT      = tostring(each.value.port)
  }
}

resource "kubernetes_config_map_v1" "retention" {
  metadata {
    name      = "retention-policy"
    namespace = kubernetes_namespace_v1.grid.metadata[0].name
    labels    = local.stack_label
  }
  data = {
    raw_days        = "{{rawdays}}"
    aggregated_days = "730"
  }
}

resource "kubernetes_secret_v1" "creds" {
  for_each = local.credentials
  metadata {
    name      = "${each.key}-credentials"
    namespace = kubernetes_namespace_v1.grid.metadata[0].name
    labels    = local.stack_label
  }
  data = {
    username = "svc-${each.key}"
  }
}

# --- workload --------------------------------------------------------------
resource "kubernetes_service_account_v1" "sa" {
  for_each = local.components
  metadata {
    name      = each.key
    namespace = kubernetes_namespace_v1.grid.metadata[0].name
    labels    = local.stack_label
  }
}

resource "kubernetes_deployment_v1" "app" {
  for_each = local.components
  metadata {
    name      = each.key
    namespace = kubernetes_namespace_v1.grid.metadata[0].name
    labels    = local.stack_label
  }
  spec {
    replicas = 1
    selector {
      match_labels = { app = each.key }
    }
    template {
      metadata {
        labels = { app = each.key }
      }
      spec {
        service_account_name = kubernetes_service_account_v1.sa[each.key].metadata[0].name
        container {
          name  = each.key
          image = "httpd:2.4-alpine"
          env_from {
            config_map_ref {
              name = kubernetes_config_map_v1.settings[each.key].metadata[0].name
            }
          }
        }
      }
    }
  }
  wait_for_rollout = false
}
