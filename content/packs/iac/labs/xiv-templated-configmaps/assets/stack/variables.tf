variable "farms" {
  description = "Wind farms whose settings ConfigMaps this stack publishes."
  type = map(object({
    turbines    = number
    capacity_mw = number
    offshore    = bool
  }))
}
