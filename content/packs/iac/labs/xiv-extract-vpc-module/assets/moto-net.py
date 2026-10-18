# moto-net.py record|check: records (once) or compares the ids of the trading VPC, its
# private subnets, route table and the order-router instance (run on the moto node).
import json, os, sys, boto3
base = "/root/ct-xiv-evm.json"
ec2 = boto3.client("ec2", endpoint_url="http://localhost:5000", region_name="eu-west-2",
                   aws_access_key_id="saltmarsh-lab", aws_secret_access_key="saltmarsh-lab-secret")
def tagged(items, key):
    out = {}
    for i in items:
        n = {t["Key"]: t["Value"] for t in i.get("Tags", [])}.get("Name")
        if n:
            out.setdefault(n, []).append(i[key])
    return out
now = {}
now.update(tagged(ec2.describe_vpcs()["Vpcs"], "VpcId"))
now.update(tagged(ec2.describe_subnets()["Subnets"], "SubnetId"))
now.update(tagged(ec2.describe_route_tables()["RouteTables"], "RouteTableId"))
now.update(tagged([i for r in ec2.describe_instances(Filters=[{"Name": "instance-state-name", "Values": ["pending", "running"]}])["Reservations"] for i in r["Instances"]], "InstanceId"))
names = ["order-net", "order-net-private-a", "order-net-private-b", "order-net-private", "order-router"]
if sys.argv[1] == "record":
    if not os.path.exists(base):
        json.dump({n: now.get(n, [None])[0] for n in names}, open(base, "w"))
    raise SystemExit(0)
was = json.load(open(base))
same = sum(1 for n in names if now.get(n) == [was[n]])
print(f"same={same}/{len(names)}")
