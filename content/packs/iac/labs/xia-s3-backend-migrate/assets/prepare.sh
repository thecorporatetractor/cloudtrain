#!/bin/sh
# Starts the workstation's S3 store and creates the exam bucket (run as the learner).
set -eu
ct-s3 start
ct-s3 bucket saltmarsh-exam --versioning
