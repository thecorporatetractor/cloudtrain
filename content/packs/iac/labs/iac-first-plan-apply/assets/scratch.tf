# Scratch stack from last week's survey dry run. Nobody needs it any more.
terraform {
  required_providers {
    local = {
      source = "hashicorp/local"
    }
  }
}

resource "local_file" "dry_run" {
  filename = "/home/learner/survey/dry-run-{{scratch}}.txt"
  content  = "dry run {{scratch}}: delete me\n"
}
