resource "aws_s3_bucket" "open" {
  bucket = "fixture-open"
  tags   = { "cost-centre" = "trading-ops" }
}

resource "aws_s3_bucket_public_access_block" "open" {
  bucket                  = aws_s3_bucket.open.id
  block_public_acls       = true
  block_public_policy     = false
  ignore_public_acls      = true
  restrict_public_buckets = true
}
