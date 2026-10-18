module "gullhaven" {
  source        = "git::file:///home/learner/git/farm-base.git?ref=v1.4.0"
  farm_name     = "gullhaven"
  turbine_count = {{turbines}}
  namespace     = "farm-upgrade"
}
