terraform {
  backend "s3" {
    bucket                      = "sm-tfstate"
    key                         = "quotes/terraform.tfstate"
    use_lockfile                = true
    region                      = "us-east-1"
    endpoints                   = { s3 = "http://127.0.0.1:8333" }
    use_path_style              = true
    skip_credentials_validation = true
    skip_region_validation      = true
    skip_requesting_account_id  = true
    skip_metadata_api_check     = true
  }
}

data "terraform_remote_state" "network" {
  backend = "s3"
  config = {
    bucket                      = "sm-tfstate"
    key                         = "core-network/terraform.tfstate"
    region                      = "us-east-1"
    endpoints                   = { s3 = "http://127.0.0.1:8333" }
    use_path_style              = true
    skip_credentials_validation = true
    skip_region_validation      = true
    skip_requesting_account_id  = true
    skip_metadata_api_check     = true
  }
}

resource "aws_instance" "quotes" {
  ami           = "ami-12c6146b"
  instance_type = "t3.small"
  subnet_id     = data.terraform_remote_state.network.outputs.app_subnet
  tags          = { Name = "quotes-api", team = "trading" }
}
