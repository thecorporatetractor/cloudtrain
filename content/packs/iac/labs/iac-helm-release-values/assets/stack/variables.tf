variable "title" {
  description = "Dashboard header."
  type        = string
}

variable "farms" {
  description = "Wind farms shown on the dashboard, keyed by farm name."
  type = map(object({
    turbines    = number
    capacity_mw = number
  }))
}
