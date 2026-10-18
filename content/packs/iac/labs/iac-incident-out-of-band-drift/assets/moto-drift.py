# The outage edits: three ingress rules added by hand (run once on the moto node after the
# seed apply). Records the group id and the approved rule's id.
import json, os, boto3
base = "/root/ct-oob.json"
if os.path.exists(base):
    raise SystemExit(0)
ec2 = boto3.client("ec2", endpoint_url="http://localhost:5000", region_name="eu-west-2",
                   aws_access_key_id="saltmarsh-lab", aws_secret_access_key="saltmarsh-lab-secret")
sg = ec2.describe_security_groups(Filters=[{"Name": "group-name", "Values": ["trading-desk-app"]}])["SecurityGroups"][0]
ids = {}
for name, port, cidr, desc in [("approved", {{port}}, "10.47.32.0/20", "Market data feed (CHG-{{chg}})"),
                               ("rdp", 3389, "0.0.0.0/0", "vendor remote session"),
                               ("debug", 9229, "10.0.0.0/8", "node debugger")]:
    r = ec2.authorize_security_group_ingress(GroupId=sg["GroupId"], IpPermissions=[{
        "IpProtocol": "tcp", "FromPort": port, "ToPort": port,
        "IpRanges": [{"CidrIp": cidr, "Description": desc}]}])
    ids[name] = r["SecurityGroupRules"][0]["SecurityGroupRuleId"]
json.dump({"sg": sg["GroupId"], "rules": ids}, open(base, "w"))
