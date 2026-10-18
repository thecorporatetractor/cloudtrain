# Prints the region of each quote archive bucket (run on the moto node).
import boto3
s3 = boto3.client("s3", endpoint_url="http://localhost:5000", region_name="eu-west-2",
                  aws_access_key_id="saltmarsh-lab", aws_secret_access_key="saltmarsh-lab-secret")
out = []
for b in sorted(x["Name"] for x in s3.list_buckets()["Buckets"] if x["Name"].startswith("sm-quote-archive-")):
    loc = s3.get_bucket_location(Bucket=b).get("LocationConstraint") or "us-east-1"
    out.append(f"{b}={loc}")
print(" ".join(out))
