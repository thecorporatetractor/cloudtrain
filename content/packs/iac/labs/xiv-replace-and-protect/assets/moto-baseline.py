# Records the pricing instance ids and the archive bucket's creation date once (moto node).
import json, os, boto3
base = "/root/ct-xiv-rap.json"
if os.path.exists(base):
    raise SystemExit(0)
kw = dict(endpoint_url="http://localhost:5000", region_name="eu-west-2",
          aws_access_key_id="saltmarsh-lab", aws_secret_access_key="saltmarsh-lab-secret")
ec2, s3 = boto3.client("ec2", **kw), boto3.client("s3", **kw)
ids = {}
for r in ec2.describe_instances(Filters=[{"Name": "tag:team", "Values": ["trading"]},
                                         {"Name": "instance-state-name", "Values": ["running"]}])["Reservations"]:
    for i in r["Instances"]:
        name = {t["Key"]: t["Value"] for t in i.get("Tags", [])}.get("Name")
        ids[name] = i["InstanceId"]
b = {x["Name"]: x["CreationDate"].isoformat() for x in s3.list_buckets()["Buckets"]}
json.dump({"ids": ids, "bucket": b.get("sm-pricing-archive-{{suffix}}")}, open(base, "w"))
