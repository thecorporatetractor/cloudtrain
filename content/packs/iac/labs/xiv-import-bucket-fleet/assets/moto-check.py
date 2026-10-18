# Prints how many archive buckets are the originals with their tags (run on the moto node).
import json, boto3
s3 = boto3.client("s3", endpoint_url="http://localhost:5000", region_name="eu-west-2",
                  aws_access_key_id="saltmarsh-lab", aws_secret_access_key="saltmarsh-lab-secret")
base = json.load(open("/root/ct-xiv-ibf.json"))
now = {b["Name"]: b["CreationDate"].isoformat() for b in s3.list_buckets()["Buckets"]}
same = tagged = 0
for y in range(2019, 2025):
    b = f"sm-telemetry-archive-{y}"
    if b in now and now[b] == base.get(b):
        same += 1
    try:
        tags = {t["Key"]: t["Value"] for t in s3.get_bucket_tagging(Bucket=b)["TagSet"]}
    except Exception:
        tags = {}
    if tags == {"saltmarsh.example/retention": "{{retention}}", "saltmarsh.example/data": "telemetry"}:
        tagged += 1
extra = len([n for n in now if n.startswith("sm-telemetry-archive-")]) - 6
print(f"same={same} tagged={tagged} extra={extra}")
