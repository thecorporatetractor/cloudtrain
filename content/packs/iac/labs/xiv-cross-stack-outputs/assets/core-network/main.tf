terraform {
  backend "s3" {
    bucket                      = "sm-tfstate"
    key                         = "core-network/terraform.tfstate"
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

resource "aws_vpc" "core" {
  cidr_block = "10.{{net}}.0.0/16"
  tags       = { Name = "core" }
}

resource "aws_subnet" "app" {
  vpc_id            = aws_vpc.core.id
  cidr_block        = "10.{{net}}.1.0/24"
  availability_zone = "eu-west-2a"
  tags              = { Name = "core-app" }
}

resource "aws_subnet" "data" {
  vpc_id            = aws_vpc.core.id
  cidr_block        = "10.{{net}}.2.0/24"
  availability_zone = "eu-west-2b"
  tags              = { Name = "core-data" }
}

output "vpc_id" {
  value = aws_vpc.core.id
}

output "app_subnet" {
  value = aws_subnet.app.id
}

output "data_subnet" {
  value = aws_subnet.data.id
}
