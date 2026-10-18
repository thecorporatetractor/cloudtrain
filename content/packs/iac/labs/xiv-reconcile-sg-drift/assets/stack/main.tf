resource "aws_vpc" "trading" {
  cidr_block = "10.40.0.0/16"
  tags       = { Name = "trading-desk" }
}

resource "aws_security_group" "trading" {
  name        = "trading-desk"
  description = "Trading desk application servers"
  vpc_id      = aws_vpc.trading.id

  ingress {
    description = "HTTPS from the trading VPC"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["10.40.0.0/16"]
  }

  ingress {
    description = "SSH from the bastion subnet"
    from_port   = 22
    to_port     = 22
    protocol    = "tcp"
    cidr_blocks = ["10.40.250.0/24"]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}
