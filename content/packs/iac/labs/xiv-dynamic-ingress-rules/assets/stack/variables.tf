variable "services" {
  description = "Telemetry service catalogue: the port each service listens on and the apps allowed to call it."
  type = map(object({
    port         = number
    allowed_from = list(string)
  }))
}
