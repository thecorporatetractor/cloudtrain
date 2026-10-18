variable "vpc_cidr" {
  description = "Address range of the trading desk VPC."
  type        = string
  default     = "10.40.0.0/16"
}

variable "zones" {
  description = "Availability zones that get one private /20 subnet each, in this order."
  type        = list(string)
  default     = ["eu-west-2a", "eu-west-2b", "eu-west-2c"]
}
