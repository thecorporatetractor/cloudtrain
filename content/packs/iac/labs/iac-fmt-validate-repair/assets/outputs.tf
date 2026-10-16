output "alert_files" {
  description = "Paths of the generated alert files"
  value = [for f in local_file.alert : f.filename }
}
