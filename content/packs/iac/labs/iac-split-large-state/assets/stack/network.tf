# Grid telemetry network: one subnet and one security group per substation segment.
locals {
  segments = { for i in range(40) : format("seg%02d", i) => i }
}

resource "aws_vpc" "grid" {
  cidr_block = "10.62.0.0/16"
  tags       = { Name = "grid-telemetry", layer = "network" }
}

resource "aws_subnet" "segment" {
  for_each   = local.segments
  vpc_id     = aws_vpc.grid.id
  cidr_block = cidrsubnet(aws_vpc.grid.cidr_block, 8, each.value)
  tags       = { Name = "grid-${each.key}", layer = "network" }
}

resource "aws_security_group" "segment" {
  for_each    = local.segments
  name        = "grid-${each.key}"
  description = "Collectors in ${each.key}"
  vpc_id      = aws_vpc.grid.id
  tags        = { layer = "network" }
}
