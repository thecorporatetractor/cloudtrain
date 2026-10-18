resource "aws_vpc" "untagged" {
  cidr_block = "10.46.0.0/16"
  tags       = { Name = "no-cost-centre" }
}
