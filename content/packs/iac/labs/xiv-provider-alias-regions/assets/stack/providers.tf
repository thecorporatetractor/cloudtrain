terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.67.0"
    }
  }
}

# Saltmarsh's AWS-shaped endpoint (Moto on node moto). It emulates the API shape,
# not AWS behaviour; credentials come from ~/.aws/credentials.
provider "aws" {
  region                      = "eu-west-2"
  s3_use_path_style           = true
  skip_credentials_validation = true
  skip_requesting_account_id  = true
  skip_metadata_api_check     = true
  endpoints {
    ec2 = "http://moto:5000"
    s3  = "http://moto:5000"
    sts = "http://moto:5000"
  }
}
