# Prints whether the approved rule is the original hand-made rule and the group's ingress
# rules as port:source (run on the moto node).
import json, boto3
ec2 = boto3.client("ec2", endpoint_url="http://localhost:5000", region_name="eu-west-2",
                   aws_access_key_id="saltmarsh-lab", aws_secret_access_key="saltmarsh-lab-secret")
b = json.load(open("/root/ct-oob.json"))
rules = ec2.describe_security_group_rules(Filters=[{"Name": "group-id", "Values": [b["sg"]]}])["SecurityGroupRules"]
ing = sorted(f'{r.get("FromPort")}:{r.get("CidrIpv4")}' for r in rules if not r["IsEgress"])
orig = any(r["SecurityGroupRuleId"] == b["rules"]["approved"] for r in rules)
print(f'approved={"original" if orig else "missing"} ingress={",".join(ing)}')
