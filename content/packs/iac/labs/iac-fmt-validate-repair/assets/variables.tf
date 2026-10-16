variable "farms" {
  description = "Cut-out wind speed in m/s per wind farm"
  type = map(number)
  default = {
    gullhaven = 25
      redmoor   = 23
    skerrow = {{skerrow}}
  }
}

variable "alert_dir" {
  type    = string
  default = "/home/learner/alerts"
}
