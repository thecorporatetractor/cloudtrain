output "namespace" {
  value = kubernetes_namespace_v1.farm.metadata[0].name
}

output "quota" {
  value = kubernetes_resource_quota_v1.farm.spec[0].hard
}

output "summary_path" {
  value = local_file.summary.filename
}
