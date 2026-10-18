# Tenant teams on the qm-tenants cluster and their quota (values agreed with platform).
locals {
  teams = {
    dispatch = { cpu = "{{dcpu}}", memory = "{{dmem}}Gi", pods = 20 }
    customs  = { cpu = "2", memory = "4Gi", pods = 10 }
    fleet    = { cpu = "{{fcpu}}", memory = "8Gi", pods = {{fpods}} }
  }
}
