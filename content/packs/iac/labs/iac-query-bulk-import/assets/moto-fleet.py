# Creates the hand-made fleet once: trading instances (to adopt) and ops instances (not
# ours), and records their ids (run on the moto node). Prints nothing.
import json, os, boto3
base = "/root/ct-qbi.json"
if os.path.exists(base):
    raise SystemExit(0)
ec2 = boto3.client("ec2", endpoint_url="http://localhost:5000", region_name="eu-west-2",
                   aws_access_key_id="saltmarsh-lab", aws_secret_access_key="saltmarsh-lab-secret")
vpc = ec2.create_vpc(CidrBlock="10.48.0.0/16")["Vpc"]["VpcId"]
sub = ec2.create_subnet(VpcId=vpc, CidrBlock="10.48.1.0/24", AvailabilityZone="eu-west-2a")["Subnet"]["SubnetId"]
ids = {"trading": [], "ops": []}
roles = ["pricer", "pricer", "risk", "risk", "fix-gateway", "md-cache", "md-cache", "backtest", "reporting"][:int("{{count}}")]
for team, names in (("trading", [f"trading-{r}-{i}" for i, r in enumerate(roles)]), ("ops", ["ops-bastion", "ops-monitor", "ops-ci-runner"])):
    for n in names:
        i = ec2.run_instances(ImageId="ami-12c6146b", InstanceType="t3.small", MinCount=1, MaxCount=1, SubnetId=sub,
                              TagSpecifications=[{"ResourceType": "instance", "Tags": [{"Key": "Name", "Value": n}, {"Key": "team", "Value": team}]}])
        ids[team].append(i["Instances"][0]["InstanceId"])
json.dump(ids, open(base, "w"))
