terraform {
  required_providers {
    vsphere = {
      source  = "hashicorp/vsphere"
      version = "~> 2.12.0"
    }
  }
}

# The simulated vCenter on this workstation (ct-vcsim). Lab-only credentials; the
# simulator's certificate is self-signed.
provider "vsphere" {
  vsphere_server       = "127.0.0.1:8989"
  user                 = "saltmarsh"
  password             = "saltmarsh-lab"
  allow_unverified_ssl = true
}
