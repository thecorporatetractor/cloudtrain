module "gullhaven" {
  source    = "./modules/farm-base"
  farm      = "gullhaven"
  turbines  = {{gt}}
  namespace = "fleet-agents"
}

module "redmoor" {
  source    = "./modules/farm-base"
  farm      = "redmoor"
  turbines  = {{rt}}
  namespace = "fleet-agents"
}

module "skerrow" {
  source    = "./modules/farm-base"
  farm      = "skerrow"
  turbines  = {{st}}
  namespace = "fleet-agents"
}

output "agents" {
  value = [module.gullhaven.service_account, module.redmoor.service_account, module.skerrow.service_account]
}
