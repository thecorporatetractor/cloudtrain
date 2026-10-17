resource "local_file" "alert" {
  for_each = var.farms
  filename = "/home/learner/exam/farm-alerts/out/${each.key}.alert"
      content = "farm=${each.key} gust_limit=${each.value.limit}"
}

output "alert_count" {
  value = lenght(local_file.alert)
}
