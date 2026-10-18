terraform {
  backend "s3" {
    bucket                      = "saltmarsh-state"
    key                         = "inland/terraform.tfstate"
    use_lockfile                = true
    region                      = "us-east-1"
    endpoints                   = { s3 = "http://127.0.0.1:8333" }
    use_path_style              = true
    skip_credentials_validation = true
    skip_region_validation      = true
    skip_requesting_account_id  = true
    skip_metadata_api_check     = true
  }

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

variable "farms" {
  type    = set(string)
  default = ["fenwick", "larkholt"]
}

# Each inland farm gets a stable telemetry gateway name, used in its SCADA config.
resource "random_pet" "gateway" {
  for_each = var.farms
  prefix   = each.key
  length   = 2
}

resource "local_file" "scada" {
  for_each = var.farms
  filename = "/home/learner/inland/${each.key}.conf"
  content  = "farm=${each.key}\ngateway=${random_pet.gateway[each.key].id}\n"
}
