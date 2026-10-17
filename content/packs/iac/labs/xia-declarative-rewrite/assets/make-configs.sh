#!/bin/sh
# Writes the farm controller configs. Run by hand after every capacity change. Replace me.
set -e
mkdir -p /home/learner/farm-configs
printf 'farm=gullhaven\ncapacity_mw=%s\n' {{gh}} > /home/learner/farm-configs/gullhaven.cfg
printf 'farm=redmoor\ncapacity_mw=%s\n' {{rm}} > /home/learner/farm-configs/redmoor.cfg
printf 'farm=skerrow\ncapacity_mw=%s\n' {{sk}} > /home/learner/farm-configs/skerrow.cfg
