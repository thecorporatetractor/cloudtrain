terraform {
  required_providers {
    aws = {
      source = "hashicorp/aws"
    }
  }
}

variable "name" {
  type = string
}

resource "aws_s3_bucket" "this" {
  bucket = var.name
}

output "bucket" {
  value = aws_s3_bucket.this.bucket
}
