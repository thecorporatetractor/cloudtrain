variable "farms" {
  description = "Wind farms that get a VM folder and a resource pool, with the pool's CPU shares."
  type = map(object({
    cpu_shares = number
  }))
}
