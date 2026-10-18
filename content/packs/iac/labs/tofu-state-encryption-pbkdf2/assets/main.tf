terraform {
  required_providers {
    random = {
      source  = "hashicorp/random"
      version = "~> 3.9.0"
    }
  }

  backend "s3" {
    bucket                      = "saltmarsh-state"
    key                         = "trading/terraform.tfstate"
    region                      = "us-east-1"
    endpoints                   = { s3 = "http://127.0.0.1:8333" }
    use_path_style              = true
    use_lockfile                = true
    skip_credentials_validation = true
    skip_region_validation      = true
    skip_requesting_account_id  = true
    skip_metadata_api_check     = true
  }
}

resource "random_pet" "desk" {
  prefix = "trading"
}

# The pricing API key lives in state, which is why the state must be encrypted.
resource "random_password" "pricing_api" {
  length  = 24
  special = false
}
