# Prints the trading VPC and its subnets as range:zone:zone-tag (run on the moto node).
import boto3
ec2 = boto3.client("ec2", endpoint_url="http://localhost:5000", region_name="eu-west-2",
                   aws_access_key_id="saltmarsh-lab", aws_secret_access_key="saltmarsh-lab-secret")
vpcs = [v for v in ec2.describe_vpcs(Filters=[{"Name": "tag:Name", "Values": ["trading"]}])["Vpcs"] if v["CidrBlock"] == "10.40.0.0/16"]
if len(vpcs) != 1:
    print(f"vpcs={len(vpcs)}"); raise SystemExit(0)
subs = ec2.describe_subnets(Filters=[{"Name": "vpc-id", "Values": [vpcs[0]["VpcId"]]}])["Subnets"]
out = []
for s in sorted(subs, key=lambda s: s["CidrBlock"]):
    tags = {t["Key"]: t["Value"] for t in s.get("Tags", [])}
    out.append(f'{s["CidrBlock"]}:{s["AvailabilityZone"]}:{tags.get("zone", "-")}')
print("vpc=1 " + " ".join(out))
