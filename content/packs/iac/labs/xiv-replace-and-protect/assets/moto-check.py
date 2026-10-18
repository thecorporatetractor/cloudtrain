# Prints whether the corrupted instance (argv[1]: a|b) was replaced and the healthy
# instance and the archive bucket are the originals (moto node).
import json, sys, boto3
bad = sys.argv[1]
kw = dict(endpoint_url="http://localhost:5000", region_name="eu-west-2",
          aws_access_key_id="saltmarsh-lab", aws_secret_access_key="saltmarsh-lab-secret")
ec2, s3 = boto3.client("ec2", **kw), boto3.client("s3", **kw)
base = json.load(open("/root/ct-xiv-rap.json"))
live = {}
for r in ec2.describe_instances(Filters=[{"Name": "tag:team", "Values": ["trading"]},
                                         {"Name": "instance-state-name", "Values": ["pending", "running"]}])["Reservations"]:
    for i in r["Instances"]:
        name = {t["Key"]: t["Value"] for t in i.get("Tags", [])}.get("Name")
        live.setdefault(name, []).append(i["InstanceId"])
out = []
for role, n in (("corrupted", "pricing-" + bad), ("healthy", "pricing-" + ("b" if bad == "a" else "a"))):
    got = live.get(n, [])
    out.append(f"{role}=" + ("missing" if not got else "dup" if len(got) > 1 else "same" if got[0] == base["ids"].get(n) else "new"))
b = {x["Name"]: x["CreationDate"].isoformat() for x in s3.list_buckets()["Buckets"]}.get("sm-pricing-archive-{{suffix}}")
out.append("archive=" + ("missing" if b is None else "same" if b == base["bucket"] else "new"))
print(" ".join(out))
