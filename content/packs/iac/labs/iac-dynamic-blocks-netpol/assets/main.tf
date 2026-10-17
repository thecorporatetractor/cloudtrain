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

variable "ingest_ports" {
  description = "Ports the telemetry collectors accept traffic on"
  type = list(object({
    port     = number
    protocol = string
  }))
  default = [
    { port = 4317, protocol = "TCP" },
    { port = 514, protocol = "UDP" },
    { port = {{modbus}}, protocol = "TCP" },
  ]
}

resource "kubernetes_namespace_v1" "telemetry" {
  metadata {
    name = "grid-telemetry"
  }
}

resource "kubernetes_network_policy_v1" "collector_ingress" {
  metadata {
    name      = "collector-ingress"
    namespace = kubernetes_namespace_v1.telemetry.metadata[0].name
  }

  spec {
    pod_selector {
      match_labels = {
        app = "collector"
      }
    }
    policy_types = ["Ingress"]

    ingress {
      ports {
        port     = "4317"
        protocol = "TCP"
      }
      ports {
        port     = "514"
        protocol = "UDP"
      }
    }
  }
}
