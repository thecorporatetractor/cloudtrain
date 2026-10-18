# Offshore farms run on sm-north-sea, inland farms on sm-inland.
module "offshore" {
  source = "./modules/farm-base"
  region = "offshore"
  farms  = { gullhaven = {{gt}}, redmoor = {{rt}}, skerrow = {{st}} }
}

# TODO: the inland farms (fenwick = {{ft}}, larkholt = {{lt}} turbines) on sm-inland.
