# Prints the state of each trading-test instance (run on the moto node).
import boto3
ec2 = boto3.client("ec2", endpoint_url="http://localhost:5000", region_name="eu-west-2",
                   aws_access_key_id="saltmarsh-lab", aws_secret_access_key="saltmarsh-lab-secret")
out = {}
for r in ec2.describe_instances(Filters=[{"Name": "tag:Name", "Values": ["trading-test-*"]},
                                         {"Name": "instance-state-name", "Values": ["pending", "running", "stopping", "stopped"]}])["Reservations"]:
    for i in r["Instances"]:
        n = {t["Key"]: t["Value"] for t in i.get("Tags", [])}["Name"].replace("trading-test-", "")
        out.setdefault(n, []).append(i["State"]["Name"])
print(" ".join(f"{n}={','.join(v)}" for n, v in sorted(out.items())))
