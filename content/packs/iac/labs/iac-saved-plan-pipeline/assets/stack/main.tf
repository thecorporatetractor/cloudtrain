terraform {
  required_providers {
    local = {
      source  = "hashicorp/local"
      version = "~> 2.9.0"
    }
  }
  backend "s3" {
    bucket                      = "saltmarsh-state"
    key                         = "trading/limits.tfstate"
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

variable "max_position_mw" {
  description = "Largest open position the desk may hold, in MW."
  type        = number
}

variable "desk" {
  type    = string
  default = "day-ahead"
}

resource "local_file" "limits" {
  filename = "/home/learner/trading/limits.conf"
  content  = "desk=${var.desk}\nmax_position_mw=${var.max_position_mw}\n"
}
