# Farm stack: one configuration for every offshore farm.
# Today it is hard-wired to one state key and one module release.
terraform {
  required_providers {
    local = {
      source  = "hashicorp/local"
      version = "~> 2.9.0"
    }
  }

  backend "s3" {
    bucket                      = "saltmarsh-state"
    key                         = "farms/terraform.tfstate"
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

variable "farm" {
  description = "Wind farm this run manages"
  type        = string
}

variable "farm_base_ref" {
  description = "Release tag of the farm-base module this farm runs"
  type        = string
}

module "farm" {
  source = "git::file:///home/learner/git/farm-base.git?ref=v1.1.0"
  farm   = var.farm
}
