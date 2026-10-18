# Merge request !142 (quant team): publish delayed quotes and add a backtest box.
resource "aws_s3_bucket" "quotes_public" {
  bucket = "sm-delayed-quotes-{{suffix}}"
}

resource "aws_s3_bucket_public_access_block" "quotes_public" {
  bucket                  = aws_s3_bucket.quotes_public.id
  block_public_acls       = false
  block_public_policy     = false
  ignore_public_acls      = false
  restrict_public_buckets = false
}

resource "aws_instance" "backtest" {
  ami           = "ami-12c6146b"
  instance_type = "t3.large"
  tags          = { Name = "quant-backtest" }
}
