# Forecast service settings, one file per environment.
resource "random_id" "instance" {
  byte_length = 4
}

resource "local_file" "forecast" {
  filename = "/home/learner/forecast/default.conf"
  content  = "env=default\nreplicas=1\ninstance=${random_id.instance.hex}\n"
}
