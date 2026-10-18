variable "archive_years" {
  description = "Years of telemetry archive kept in sm-telemetry-archive-<year> buckets."
  type        = set(string)
  default     = ["2019", "2020", "2021", "2022", "2023", "2024"]
}
