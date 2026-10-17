variable "substations" {
  description = "Grid substations and their voltage in kV"
  type        = map(number)
  default = {
    "fen-north"  = 132
    "lark-east"  = 33
    "{{third}}" = {{kv}}
  }
}
