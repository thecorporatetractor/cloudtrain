resource "aws_vpc" "lab" {
  cidr_block = "10.45.0.0/16"
  tags       = { "cost-centre" = "trading-ops", Name = "fixture" }
}

resource "aws_s3_bucket" "ok" {
  bucket = "fixture-ok"
  tags   = { "cost-centre" = "trading-ops" }
}

resource "aws_s3_bucket_public_access_block" "ok" {
  bucket                  = aws_s3_bucket.ok.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}
