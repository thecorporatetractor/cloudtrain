terraform {
  required_providers {
    local  = { source = "hashicorp/local" }
    random = { source = "hashicorp/random" }
  }
}

resource "terraform_data" "turbine" {
  for_each         = toset(["gh", "rm"])
  input            = { firmware = "4.2" }
  triggers_replace = ["controller-a"]
}

resource "random_pet" "batch" {
  keepers = { quarter = "2026-Q4" }
}

resource "local_file" "manifest" {
  filename = "/home/learner/exam/predict/out/manifest.txt"
  content  = "batch=${random_pet.batch.id}\n"
}
