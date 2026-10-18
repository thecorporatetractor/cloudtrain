# Prints what the ops stack created on the endpoint (run on the moto node).
import boto3
kw = dict(endpoint_url="http://localhost:5000", region_name="eu-west-2",
          aws_access_key_id="saltmarsh-lab", aws_secret_access_key="saltmarsh-lab-secret")
ec2, s3 = boto3.client("ec2", **kw), boto3.client("s3", **kw)
vpcs = ec2.describe_vpcs(Filters=[{"Name": "tag:Name", "Values": ["ops-net"]}])["Vpcs"]
subs = ec2.describe_subnets(Filters=[{"Name": "tag:Name", "Values": ["ops-net-tools"]}])["Subnets"]
b = [x["Name"] for x in s3.list_buckets()["Buckets"] if x["Name"].startswith("sm-ops-runbooks-")]
print(f"vpcs={len(vpcs)}:{','.join(v['CidrBlock'] for v in vpcs)} subnets={len(subs)} buckets={','.join(b) or 'none'}")
