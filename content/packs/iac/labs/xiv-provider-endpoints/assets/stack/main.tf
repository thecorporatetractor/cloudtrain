resource "aws_vpc" "ops" {
  cidr_block = "10.{{net}}.0.0/16"
  tags       = { Name = "ops-net" }
}

resource "aws_subnet" "ops" {
  vpc_id     = aws_vpc.ops.id
  cidr_block = "10.{{net}}.4.0/24"
  tags       = { Name = "ops-net-tools" }
}

resource "aws_s3_bucket" "runbooks" {
  bucket = "sm-ops-runbooks-{{suffix}}"
}
