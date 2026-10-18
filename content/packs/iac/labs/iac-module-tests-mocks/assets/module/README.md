# farm-base

Inputs: `farm` (lower-case letters), `turbines` (whole number 1-80), `summary_dir`.
Creates namespace `farm-<farm>`, ResourceQuota `farm-capacity` sized from the turbine
count (see the sizing rule in main.tf) and writes `<summary_dir>/<farm>.quota`.

Tests live in `tests/` and run with `terraform test` from this directory.
