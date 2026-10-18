# Prints how many recorded trading and ops instances still run and how many running
# instances carry team=trading in total (run on the moto node).
import json, boto3
ec2 = boto3.client("ec2", endpoint_url="http://localhost:5000", region_name="eu-west-2",
                   aws_access_key_id="saltmarsh-lab", aws_secret_access_key="saltmarsh-lab-secret")
b = json.load(open("/root/ct-qbi.json"))
run = [i for r in ec2.describe_instances(Filters=[{"Name": "instance-state-name", "Values": ["pending", "running"]}])["Reservations"] for i in r["Instances"]]
live = {i["InstanceId"] for i in run}
tagged = sum(1 for i in run if {t["Key"]: t["Value"] for t in i.get("Tags", [])}.get("team") == "trading")
t = sum(1 for i in b["trading"] if i in live); o = sum(1 for i in b["ops"] if i in live)
print(f"originals_trading={t}/{len(b['trading'])} originals_ops={o}/{len(b['ops'])} running_trading={tagged}")
