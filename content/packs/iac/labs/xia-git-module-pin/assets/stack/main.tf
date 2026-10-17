# farm-base used to be copied into vendor/ by hand; it now lives in the internal
# Git repository /home/learner/git/farm-base.git.
module "farm" {
  source = "./vendor/farm-base"
  farm   = "{{farm}}"
}
