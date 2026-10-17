terraform {
  required_providers {
    local = {
      source  = "hashicorp/local"
      version = "~> 2.9.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.9.0"
    }
  }
}

resource "random_pet" "collector" {
  length = 2
}

resource "local_file" "collector" {
  filename = "/home/learner/telemetry/collector.id"
  content  = "collector=${random_pet.collector.id}\n"
}
