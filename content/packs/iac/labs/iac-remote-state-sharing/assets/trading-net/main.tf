terraform {
  backend "s3" {
    bucket                      = "sm-trading-tfstate"
    key                         = "trading-net/terraform.tfstate"
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

resource "aws_vpc" "trading" {
  cidr_block = "10.44.0.0/16"
  tags       = { Name = "trading-app-net" }
}

resource "aws_subnet" "app" {
  for_each          = { "eu-west-2a" = 0, "eu-west-2b" = 1 }
  vpc_id            = aws_vpc.trading.id
  availability_zone = each.key
  cidr_block        = cidrsubnet("10.44.0.0/16", 8, each.value)
  tags              = { Name = "trading-app-${each.key}" }
}
