resource "aws_vpc" "desk" {
  cidr_block = "10.47.0.0/16"
  tags       = { Name = "trading-desk-net" }
}

resource "aws_security_group" "desk" {
  name        = "trading-desk-app"
  description = "Trading desk application servers"
  vpc_id      = aws_vpc.desk.id
}

resource "aws_vpc_security_group_ingress_rule" "https" {
  security_group_id = aws_security_group.desk.id
  description       = "HTTPS from the trading VPC"
  ip_protocol       = "tcp"
  from_port         = 443
  to_port           = 443
  cidr_ipv4         = "10.47.0.0/16"
}

resource "aws_vpc_security_group_egress_rule" "all" {
  security_group_id = aws_security_group.desk.id
  ip_protocol       = "-1"
  cidr_ipv4         = "0.0.0.0/0"
}
