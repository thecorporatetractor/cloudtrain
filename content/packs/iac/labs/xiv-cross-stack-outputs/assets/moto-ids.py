# moto-ids.py record|check NAME...: records the ids of the running instances tagged
# Name=NAME once, or prints NAME=same|new|missing per name (run on the moto node).
import json, os, sys, boto3
mode, names = sys.argv[1], sys.argv[2:]
base = "/root/ct-ids-" + "-".join(names) + ".json"
ec2 = boto3.client("ec2", endpoint_url="http://localhost:5000", region_name="eu-west-2",
                   aws_access_key_id="saltmarsh-lab", aws_secret_access_key="saltmarsh-lab-secret")
live = {}
for r in ec2.describe_instances(Filters=[{"Name": "instance-state-name", "Values": ["pending", "running", "stopped"]}])["Reservations"]:
    for i in r["Instances"]:
        n = {t["Key"]: t["Value"] for t in i.get("Tags", [])}.get("Name")
        live.setdefault(n, []).append(i["InstanceId"])
if mode == "record":
    if not os.path.exists(base):
        json.dump({n: live.get(n, [None])[0] for n in names}, open(base, "w"))
    raise SystemExit(0)
was = json.load(open(base))
print(" ".join(f"{n}=" + ("missing" if not live.get(n) else "dup" if len(live[n]) > 1 else "same" if live[n][0] == was.get(n) else "new") for n in names))
