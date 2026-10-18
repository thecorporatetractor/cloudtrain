terraform {
  required_version = "~> 1.5.0"

  required_providers {
    random = {
      source  = "hashicorp/random"
      version = "~> 3.7.0"
    }
  }

  backend "s3" {
    bucket                      = "saltmarsh-state"
    key                         = "trading/terraform.tfstate"
    region                      = "us-east-1"
    endpoint                    = "http://127.0.0.1:8333"
    force_path_style            = true
    skip_credentials_validation = true
    skip_region_validation      = true
    skip_metadata_api_check     = true
  }
}

resource "random_pet" "desk" {
  prefix = "trading"
}

resource "random_integer" "feed_port" {
  min = 20000
  max = 29999
}

output "desk" {
  value = "${random_pet.desk.id}:${random_integer.feed_port.result}"
}
