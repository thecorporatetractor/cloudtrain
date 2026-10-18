variable "vpc_cidr" {
  type    = string
  default = "10.{{net}}.0.0/16"
}

variable "zones" {
  description = "Availability zone => subnet number (netnum) inside the VPC range, /20 subnets."
  type        = map(number)
  default = {
    "eu-west-2a" = 0
    "eu-west-2b" = 1
    "eu-west-2c" = 2
  }
}
