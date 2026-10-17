variable "farm" {
  description = "Wind farm name"
  type        = string
}

resource "local_file" "marker" {
  filename = "${path.root}/out/farm-base.txt"
  content  = "farm-base 1.1.0 farm=${var.farm}\n"
}

output "version" {
  value = "1.1.0"
}
