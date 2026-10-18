resource "aws_vpc" "market" {
  cidr_block = var.vpc_cidr
  tags       = { Name = "market-data" }
}

resource "aws_route_table" "private" {
  vpc_id = aws_vpc.market.id
  tags   = { Name = "market-data-private" }
}

resource "aws_subnet" "a" {
  vpc_id            = aws_vpc.market.id
  availability_zone = "eu-west-2a"
  cidr_block        = "10.{{net}}.0.0/20"
  tags              = { Name = "market-data-eu-west-2a" }
}

resource "aws_subnet" "b" {
  vpc_id            = aws_vpc.market.id
  availability_zone = "eu-west-2b"
  cidr_block        = "10.{{net}}.16.0/20"
  tags              = { Name = "market-data-eu-west-2b" }
}

resource "aws_subnet" "c" {
  vpc_id            = aws_vpc.market.id
  availability_zone = "eu-west-2c"
  cidr_block        = "10.{{net}}.32.0/20"
  tags              = { Name = "market-data-eu-west-2c" }
}

resource "aws_route_table_association" "a" {
  subnet_id      = aws_subnet.a.id
  route_table_id = aws_route_table.private.id
}

resource "aws_route_table_association" "b" {
  subnet_id      = aws_subnet.b.id
  route_table_id = aws_route_table.private.id
}

resource "aws_route_table_association" "c" {
  subnet_id      = aws_subnet.c.id
  route_table_id = aws_route_table.private.id
}
