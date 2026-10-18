# farm-base 1.4.0 (vendored copy)
terraform {
  required_providers {
    local = {
      source  = "hashicorp/local"
      version = "~> 2.9.0"
    }
  }
}

variable "farm" {
  description = "Wind farm name"
  type        = string
}

resource "local_file" "conf" {
  filename = "/home/learner/inland/${var.farm}.conf"
  content  = "farm=${var.farm}\nquota=standard\n"
}
