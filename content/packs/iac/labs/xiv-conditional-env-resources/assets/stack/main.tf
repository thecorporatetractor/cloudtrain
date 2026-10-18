module "staging" {
  source   = "./modules/telemetry"
  env      = "staging"
  replicas = 1
}

module "prod" {
  source   = "./modules/telemetry"
  env      = "prod"
  replicas = {{prodr}}
}
