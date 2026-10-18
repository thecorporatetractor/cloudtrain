terraform {
  required_version = "~> 1.9.0"
  required_providers {
    random = {
      source  = "hashicorp/random"
      version = "~> 3.7.0"
    }
  }
  backend "s3" {
    bucket                      = "sm-trading-tfstate"
    key                         = "pricing/terraform.tfstate"
    dynamodb_table              = "sm-trading-tflocks"
    region                      = "eu-west-2"
    endpoints                   = { s3 = "http://127.0.0.1:8333", dynamodb = "http://moto:5000" }
    use_path_style              = true
    skip_credentials_validation = true
    skip_region_validation      = true
    skip_requesting_account_id  = true
    skip_metadata_api_check     = true
  }
}

resource "random_pet" "service" {
  prefix = "pricing"
  length = 2
}

resource "terraform_data" "release" {
  input = { service = random_pet.service.id, desk = "trading" }
}

output "service" {
  value = random_pet.service.id
}
