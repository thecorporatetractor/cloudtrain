# moto-ids.py record|check: records (once) or compares the grid-telemetry network ids and
# archive bucket creation dates (run on the moto node).
import json, os, sys, boto3
base = "/root/ct-sls.json"
kw = dict(endpoint_url="http://localhost:5000", region_name="eu-west-2",
          aws_access_key_id="saltmarsh-lab", aws_secret_access_key="saltmarsh-lab-secret")
ec2, s3 = boto3.client("ec2", **kw), boto3.client("s3", **kw)
def now():
    vpcs = ec2.describe_vpcs(Filters=[{"Name": "tag:Name", "Values": ["grid-telemetry"]}])["Vpcs"]
    subs = ec2.describe_subnets(Filters=[{"Name": "tag:layer", "Values": ["network"]}])["Subnets"]
    sgs = ec2.describe_security_groups(Filters=[{"Name": "group-name", "Values": ["grid-seg*"]}])["SecurityGroups"]
    bks = [b for b in s3.list_buckets()["Buckets"] if b["Name"].startswith("sm-grid-")]
    return {"net": sorted([v["VpcId"] for v in vpcs] + [s["SubnetId"] for s in subs] + [g["GroupId"] for g in sgs]),
            "buckets": sorted(f'{b["Name"]}@{b["CreationDate"].isoformat()}' for b in bks)}
if sys.argv[1] == "record":
    if not os.path.exists(base):
        json.dump(now(), open(base, "w"))
    raise SystemExit(0)
was, cur = json.load(open(base)), now()
print(f'network={len(set(was["net"]) & set(cur["net"]))}/{len(was["net"])} extra_network={len(set(cur["net"]) - set(was["net"]))} '
      f'buckets={len(set(was["buckets"]) & set(cur["buckets"]))}/{len(was["buckets"])}')
