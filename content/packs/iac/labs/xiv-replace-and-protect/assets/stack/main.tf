resource "aws_vpc" "pricing" {
  cidr_block = "10.41.0.0/16"
  tags       = { Name = "pricing" }
}

resource "aws_subnet" "pricing" {
  vpc_id            = aws_vpc.pricing.id
  cidr_block        = "10.41.0.0/24"
  availability_zone = "eu-west-2a"
}

resource "aws_instance" "pricing" {
  for_each      = toset(["a", "b"])
  ami           = "ami-12c6146b"
  instance_type = "t3.small"
  subnet_id     = aws_subnet.pricing.id
  tags          = { Name = "pricing-${each.key}", team = "trading" }
}

resource "aws_s3_bucket" "archive" {
  bucket = "sm-pricing-archive-{{suffix}}"
  tags   = { team = "trading", data = "price-history" }
}
