#!/bin/sh
# The merge gate the wind-farm repository runs on every merge request.
set -e
terraform fmt -check -recursive
terraform init -backend=false -input=false
terraform validate
