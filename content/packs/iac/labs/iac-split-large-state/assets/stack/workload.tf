# Grid telemetry workload: one archive bucket and manifest per collector.
locals {
  collectors = toset([for i in range(60) : format("col%02d", i)])
}

resource "aws_s3_bucket" "archive" {
  for_each = local.collectors
  bucket   = "sm-grid-{{suffix}}-${each.key}"
}

resource "aws_s3_object" "manifest" {
  for_each = local.collectors
  bucket   = aws_s3_bucket.archive[each.key].id
  key      = "manifest.json"
  content  = jsonencode({ collector = each.key, flush_seconds = {{flush}} })
}
