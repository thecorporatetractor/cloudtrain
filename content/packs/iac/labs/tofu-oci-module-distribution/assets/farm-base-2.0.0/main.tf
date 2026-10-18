# farm-base 2.0.0
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
  content  = "farm=${var.farm}\nquota=standard\nschema=2\n"
}

output "path" {
  value = local_file.conf.filename
}
