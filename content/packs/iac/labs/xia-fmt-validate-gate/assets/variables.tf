variable "farms" {
    description = "Gust limit in m/s per farm"
  type = map(number)
  default = {
    gullhaven = 18
    redmoor = {{rm}}
  }
}
