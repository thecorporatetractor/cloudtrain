# Out-of-band edits made during the outage (run once on the moto node after the seed apply).
import json, os, boto3
base = "/root/ct-xiv-sg.json"
if os.path.exists(base):
    raise SystemExit(0)
ec2 = boto3.client("ec2", endpoint_url="http://localhost:5000", region_name="eu-west-2",
                   aws_access_key_id="saltmarsh-lab", aws_secret_access_key="saltmarsh-lab-secret")
sg = ec2.describe_security_groups(Filters=[{"Name": "group-name", "Values": ["trading-desk"]}])["SecurityGroups"][0]
for port, cidr, desc in [(8443, "10.40.16.0/20", "Pricing feed (CHG-{{chg}})"),
                         ({{rdp}}, "0.0.0.0/0", "temp access"), (5432, "0.0.0.0/0", "db debug")]:
    ec2.authorize_security_group_ingress(GroupId=sg["GroupId"], IpPermissions=[{
        "IpProtocol": "tcp", "FromPort": port, "ToPort": port,
        "IpRanges": [{"CidrIp": cidr, "Description": desc}]}])
json.dump({"id": sg["GroupId"]}, open(base, "w"))
