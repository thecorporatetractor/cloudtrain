# One settings ConfigMap per farm in namespace farm-settings (it exists).
# Each ConfigMap is named farm-<key> and has one data key, farm.ini:
#
#   [farm]
#   name = <key>
#   turbines = <turbines>
#   capacity_mw = <capacity_mw>
#   site = offshore|inland
