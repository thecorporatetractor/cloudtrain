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

resource "random_pet" "survey" {
  length = 2
}

resource "local_file" "survey" {
  filename = "${path.module}/out/survey-run.txt"
  content  = "survey run ${random_pet.survey.id} for {{farm}}\n"
}
