# One alert threshold file per wind farm, read by the turbine controllers.
resource "local_file" "alert" {
  for_each = var.farm
    file_name = "${var.alert_dir}/${each.key}.conf"
  content   = "farm=${each.key} max_wind_ms=${each.value}"
}
