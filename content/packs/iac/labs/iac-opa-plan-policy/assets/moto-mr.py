# Prints whether anything from merge request !142 reached the endpoint (moto node).
import boto3
kw = dict(endpoint_url="http://localhost:5000", region_name="eu-west-2",
          aws_access_key_id="saltmarsh-lab", aws_secret_access_key="saltmarsh-lab-secret")
ec2, s3 = boto3.client("ec2", **kw), boto3.client("s3", **kw)
b = [x["Name"] for x in s3.list_buckets()["Buckets"] if x["Name"].startswith("sm-delayed-quotes-")]
i = [x for r in ec2.describe_instances(Filters=[{"Name": "tag:Name", "Values": ["quant-backtest"]},
     {"Name": "instance-state-name", "Values": ["pending", "running"]}])["Reservations"] for x in r["Instances"]]
print(f"public_buckets={len(b)} backtest={len(i)}")
