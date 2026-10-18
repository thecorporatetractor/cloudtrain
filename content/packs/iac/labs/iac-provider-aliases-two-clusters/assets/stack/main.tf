# Farm status published to the operations namespace of BOTH Saltmarsh clusters:
#   sm-north-sea  offshore farms' cluster
#   sm-inland     inland farms' cluster
# Both kubeconfig contexts are in ~/.kube/config.
locals {
  farm_status = {
    reporting_interval = "{{interval}}s"
    escalation_contact = "{{contact}}@saltmarsh.example"
    schema             = "3"
  }
}
