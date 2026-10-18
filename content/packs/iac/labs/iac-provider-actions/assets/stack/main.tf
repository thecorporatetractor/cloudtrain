variable "build" {
  description = "Build under test; every new build updates the fleet's tags."
  type        = string
  default     = "{{build}}"
}

variable "fleet" {
  description = "Test instances by name."
  type        = set(string)
  default     = ["replay", "latency", "soak"]
}

resource "aws_vpc" "test" {
  cidr_block = "10.49.0.0/16"
  tags       = { Name = "trading-test" }
}

resource "aws_subnet" "test" {
  vpc_id     = aws_vpc.test.id
  cidr_block = "10.49.1.0/24"
}

resource "aws_instance" "test" {
  for_each      = var.fleet
  ami           = "ami-12c6146b"
  instance_type = "t3.medium"
  subnet_id     = aws_subnet.test.id
  tags          = { Name = "trading-test-${each.key}", build = var.build, team = "trading" }
}
