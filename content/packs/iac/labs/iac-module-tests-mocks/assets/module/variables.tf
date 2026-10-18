variable "farm" {
  description = "Wind farm name (lower-case letters)."
  type        = string
  validation {
    condition     = can(regex("^[a-z]+$", var.farm))
    error_message = "farm must be lower-case letters only."
  }
}

variable "turbines" {
  description = "Number of turbines on the farm (1-80)."
  type        = number
  validation {
    condition     = var.turbines >= 1 && var.turbines <= 80 && floor(var.turbines) == var.turbines
    error_message = "turbines must be a whole number from 1 to 80."
  }
}

variable "summary_dir" {
  description = "Directory where the module writes <farm>.quota for the capacity report."
  type        = string
}
