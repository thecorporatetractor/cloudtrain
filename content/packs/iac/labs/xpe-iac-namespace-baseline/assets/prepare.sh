#!/bin/sh
# Starts the workstation's S3 store and creates the state bucket (run as the learner).
set -eu
ct-s3 start
ct-s3 bucket qm-tfstate --versioning
