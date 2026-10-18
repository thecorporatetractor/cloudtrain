# Prints, per zone, whether the market-data subnet is the original, its range and whether
# it is associated with the private route table (moto node).
import json, boto3
ec2 = boto3.client("ec2", endpoint_url="http://localhost:5000", region_name="eu-west-2",
                   aws_access_key_id="saltmarsh-lab", aws_secret_access_key="saltmarsh-lab-secret")
base = json.load(open("/root/ct-xiv-sfm.json"))
subs = ec2.describe_subnets(Filters=[{"Name": "tag:Name", "Values": ["market-data-*"]}])["Subnets"]
rts = ec2.describe_route_tables(Filters=[{"Name": "tag:Name", "Values": ["market-data-private"]}])["RouteTables"]
assoc = {a.get("SubnetId") for rt in rts for a in rt.get("Associations", [])}
out = []
for s in sorted(subs, key=lambda s: s["AvailabilityZone"]):
    z = s["AvailabilityZone"]
    out.append(f'{z}={"same" if base.get(z) == s["SubnetId"] else "new"}:{s["CidrBlock"]}:{"routed" if s["SubnetId"] in assoc else "unrouted"}')
print(" ".join(out))
