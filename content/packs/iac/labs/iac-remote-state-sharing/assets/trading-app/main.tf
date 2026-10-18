terraform {
  backend "s3" {
    bucket                      = "sm-trading-tfstate"
    key                         = "trading-app/terraform.tfstate"
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

# Order gateways, one per zone. The subnet ids were copied from the network team's console.
resource "aws_instance" "gateway_a" {
  ami           = "ami-12c6146b"
  instance_type = "t3.small"
  subnet_id     = "@SUBNET_A@"
  tags          = { Name = "order-gateway-a", team = "trading" }
}

resource "aws_instance" "gateway_b" {
  ami           = "ami-12c6146b"
  instance_type = "t3.small"
  subnet_id     = "@SUBNET_B@"
  tags          = { Name = "order-gateway-b", team = "trading" }
}
