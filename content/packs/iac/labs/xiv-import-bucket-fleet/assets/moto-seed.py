# Creates the hand-made archive buckets on the Moto node once and records their
# creation dates (baseline for the "not recreated" check). Run on the moto node.
import json, os, boto3
base = "/root/ct-xiv-ibf.json"
if os.path.exists(base):
    raise SystemExit(0)
s3 = boto3.client("s3", endpoint_url="http://localhost:5000", region_name="eu-west-2",
                  aws_access_key_id="saltmarsh-lab", aws_secret_access_key="saltmarsh-lab-secret")
for y in range(2019, 2025):
    b = f"sm-telemetry-archive-{y}"
    s3.create_bucket(Bucket=b, CreateBucketConfiguration={"LocationConstraint": "eu-west-2"})
    s3.put_bucket_tagging(Bucket=b, Tagging={"TagSet": [
        {"Key": "saltmarsh.example/retention", "Value": "{{retention}}"},
        {"Key": "saltmarsh.example/data", "Value": "telemetry"}]})
dates = {b["Name"]: b["CreationDate"].isoformat() for b in s3.list_buckets()["Buckets"]}
json.dump(dates, open(base, "w"))
