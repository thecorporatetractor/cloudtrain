resource "aws_vpc" "order_net" {
  cidr_block           = "10.{{net}}.0.0/16"
  enable_dns_hostnames = true
  tags                 = { Name = "order-net" }
}

resource "aws_subnet" "private_a" {
  vpc_id            = aws_vpc.order_net.id
  cidr_block        = "10.{{net}}.0.0/20"
  availability_zone = "eu-west-2a"
  tags              = { Name = "order-net-private-a" }
}

resource "aws_subnet" "private_b" {
  vpc_id            = aws_vpc.order_net.id
  cidr_block        = "10.{{net}}.16.0/20"
  availability_zone = "eu-west-2b"
  tags              = { Name = "order-net-private-b" }
}

resource "aws_route_table" "private" {
  vpc_id = aws_vpc.order_net.id
  tags   = { Name = "order-net-private" }
}

resource "aws_route_table_association" "private_a" {
  subnet_id      = aws_subnet.private_a.id
  route_table_id = aws_route_table.private.id
}

resource "aws_route_table_association" "private_b" {
  subnet_id      = aws_subnet.private_b.id
  route_table_id = aws_route_table.private.id
}

resource "aws_instance" "order_router" {
  ami           = "ami-12c6146b"
  instance_type = "t3.small"
  subnet_id     = aws_subnet.private_a.id
  tags          = { Name = "order-router", team = "trading" }
}
