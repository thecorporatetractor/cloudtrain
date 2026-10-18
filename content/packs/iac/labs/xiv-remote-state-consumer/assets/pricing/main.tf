terraform {
  backend "s3" {
    bucket                      = "sm-tfstate"
    key                         = "pricing/terraform.tfstate"
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

resource "aws_instance" "pricing" {
  ami           = "ami-12c6146b"
  instance_type = "t3.small"
  subnet_id     = "@SUBNET@"
  tags          = { Name = "pricing-engine", team = "trading" }
}

resource "aws_s3_object" "feed_config" {
  bucket  = "@BUCKET@"
  key     = "config/pricing-engine.json"
  content = jsonencode({ interval_seconds = {{interval}} })
}
