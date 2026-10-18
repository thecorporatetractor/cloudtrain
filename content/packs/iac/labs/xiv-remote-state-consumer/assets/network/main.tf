terraform {
  backend "s3" {
    bucket                      = "sm-tfstate"
    key                         = "network/terraform.tfstate"
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
  cidr_block = "10.60.0.0/16"
  tags       = { Name = "trading" }
}

resource "aws_subnet" "pricing" {
  vpc_id            = aws_vpc.trading.id
  cidr_block        = "10.60.8.0/24"
  availability_zone = "eu-west-2b"
  tags              = { Name = "trading-pricing" }
}

resource "aws_s3_bucket" "feeds" {
  bucket = "sm-pricing-feeds-{{suffix}}"
}

output "pricing_subnet_id" {
  value = aws_subnet.pricing.id
}

output "feeds_bucket" {
  value = aws_s3_bucket.feeds.bucket
}
