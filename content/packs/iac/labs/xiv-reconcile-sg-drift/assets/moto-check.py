# Prints the trading-desk group's identity and its ingress rules (run on the moto node).
import json, boto3
ec2 = boto3.client("ec2", endpoint_url="http://localhost:5000", region_name="eu-west-2",
                   aws_access_key_id="saltmarsh-lab", aws_secret_access_key="saltmarsh-lab-secret")
base = json.load(open("/root/ct-xiv-sg.json"))
sgs = ec2.describe_security_groups(Filters=[{"Name": "group-name", "Values": ["trading-desk"]}])["SecurityGroups"]
if len(sgs) != 1:
    print(f"groups={len(sgs)}"); raise SystemExit(0)
sg = sgs[0]
rules = sorted(f'{p.get("FromPort")}-{p.get("ToPort")}/{p.get("IpProtocol")}:{r["CidrIp"]}'
               for p in sg["IpPermissions"] for r in p.get("IpRanges", []))
print(("same" if sg["GroupId"] == base["id"] else "new") + " " + ",".join(rules))
