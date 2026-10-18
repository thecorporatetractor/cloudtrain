terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.67.0"
    }
  }
}

# Copied from the public-cloud template; the lab estate has no internet access.
provider "aws" {
  region      = "eu-west-2"
  max_retries = 1
}
