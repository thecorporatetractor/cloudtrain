# Telemetry collector settings for one wind farm.
terraform {
  required_providers {
    local = {
      source  = "hashicorp/local"
      version = "~> 2.9.0"
    }
  }
}

resource "local_file" "collector" {
  filename = "/home/learner/telemetry/collector.conf"
  content  = "farm=${var.farm_name}\nturbines=${var.turbine_count}\nsample_seconds=${var.sample_seconds}\n"
}
