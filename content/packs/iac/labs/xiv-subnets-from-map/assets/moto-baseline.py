# Records the market-data subnet ids per zone once (moto node).
import json, os, boto3
base = "/root/ct-xiv-sfm.json"
if os.path.exists(base):
    raise SystemExit(0)
ec2 = boto3.client("ec2", endpoint_url="http://localhost:5000", region_name="eu-west-2",
                   aws_access_key_id="saltmarsh-lab", aws_secret_access_key="saltmarsh-lab-secret")
subs = ec2.describe_subnets(Filters=[{"Name": "tag:Name", "Values": ["market-data-*"]}])["Subnets"]
json.dump({s["AvailabilityZone"]: s["SubnetId"] for s in subs}, open(base, "w"))
