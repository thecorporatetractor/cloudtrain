"""Background activity: a normal working week for the world's users, devices and servers.

Noise is deliberately realistic enough to produce false positives for naive queries:
occasional wrong passwords, MFA prompts, legitimate travellers, admins doing admin work,
common processes everywhere, and irregular web traffic.
"""
from __future__ import annotations

import datetime as dt
import random

from .tables import Dataset
from .world import World, stable_hex, stable_uuid

APPS = [("Office 365 Exchange Online", "00000002-0000-0ff1-ce00-000000000000", 5),
        ("Office 365 SharePoint Online", "00000003-0000-0ff1-ce00-000000000000", 3),
        ("Microsoft Teams", "1fec8e78-bce4-4aaf-ab1b-5451cc387264", 4),
        ("My Apps", "2793995e-0a7d-40d7-bd35-6968ba142197", 1),
        ("Azure Portal", "c44b4083-3bb0-49c1-b47d-974e53cbdf3c", 0)]
FAILURES = [("50126", "Invalid username or password or Invalid on-premise username or password.", 6),
            ("50140", "This error occurred due to 'Keep me signed in' interrupt when the user was signing in.", 3),
            ("50074", "Strong Authentication is required.", 4),
            ("50055", "The password is expired.", 1)]
COMMON_PROCS = [("chrome.exe", r"C:\Program Files\Google\Chrome\Application"), ("msedge.exe", r"C:\Program Files (x86)\Microsoft\Edge\Application"),
                ("teams.exe", r"C:\Users\{u}\AppData\Local\Microsoft\Teams"), ("outlook.exe", r"C:\Program Files\Microsoft Office\root\Office16"),
                ("excel.exe", r"C:\Program Files\Microsoft Office\root\Office16"), ("svchost.exe", r"C:\Windows\System32"),
                ("conhost.exe", r"C:\Windows\System32"), ("OneDrive.exe", r"C:\Users\{u}\AppData\Local\Microsoft\OneDrive"),
                ("taskhostw.exe", r"C:\Windows\System32"), ("notepad.exe", r"C:\Windows\System32")]
WEB = ["intranet.{d}", "teams.microsoft.com", "outlook.office365.com", "{s}.sharepoint.com", "wiki.{d}",
       "news.example.net", "maps.example.org", "cdn.example.com", "updates.example.com", "pay.{d}"]
FW_VENDOR = ("Ridgeline", "RL Edge Firewall", "9.2.1")


def work_times(rng: random.Random, start: dt.datetime, days: int, utc: int, per_day: tuple[int, int]):
    """Timestamps during local office hours on weekdays (some weekend noise)."""
    for d in range(days):
        day = (start + dt.timedelta(days=d)).replace(hour=0, minute=0, second=0, microsecond=0)
        weekend = day.weekday() >= 5
        n = rng.randint(*per_day) if not weekend else (1 if rng.random() < 0.15 else 0)
        for _ in range(n):
            local_h = rng.gauss(12.5, 2.6)
            local_h = min(max(local_h, 6.5), 20.5)
            t = day + dt.timedelta(hours=local_h - utc, seconds=rng.randint(0, 59))
            if start <= t:
                yield t


def signin(ds: Dataset, w: World, rng: random.Random, t, u, ip, city, app, result="0", desc=None,
           mfa=None, auth="singleFactorAuthentication", ua=None, client="Browser", interactive=True, risk="none",
           device=True, corr=None):
    name, appid, _ = app
    ds.add("SigninLogs", TimeGenerated=t, TenantId=w.tenant_id, UserPrincipalName=u.upn, UserDisplayName=u.display,
           UserId=u.user_id, AppDisplayName=name, AppId=appid, ResourceDisplayName=name, IPAddress=ip,
           Location=city.country, LocationDetails=city.details(), ResultType=result,
           ResultDescription=desc or ("" if result == "0" else "Other"),
           Status={"errorCode": int(result), **({"failureReason": desc} if result != "0" else {})},
           DeviceDetail=({"deviceId": u.device_id, "displayName": u.device, "operatingSystem": u.os,
                          "browser": u.browser, "isCompliant": True, "trustType": "Azure AD joined"}
                         if device else {"deviceId": "", "operatingSystem": "Windows 10", "browser": "Chrome 124.0.0"}),
           ClientAppUsed=client, UserAgent=ua or f"Mozilla/5.0 ({u.os}) {u.browser}",
           ConditionalAccessStatus="success" if result == "0" else "notApplied",
           AuthenticationRequirement=auth, MfaDetail=mfa or {}, RiskLevelDuringSignIn=risk,
           IsInteractive=interactive, CorrelationId=corr or stable_uuid(rng))


def baseline(ds: Dataset, w: World, start: dt.datetime, end: dt.datetime, scale: float = 1.0):
    rng = random.Random(f"{w.seed}:baseline")
    days = (end - start).days + 1
    lo, hi = max(1, int(2 * scale)), max(2, int(6 * scale))
    apps_w = [a[2] for a in APPS]
    for u in w.users:
        home = u.city
        ip_home = home.ip(rng)
        travel = None
        if u.traveller:   # a legitimate trip: a plausible flight, days later back home
            dest = rng.choice([c for c in w.cities if c is not home and c.name != home.name][:12])
            leave = start + dt.timedelta(days=rng.randint(1, max(1, days - 3)))
            travel = (leave, leave + dt.timedelta(days=2), dest, dest.ip(rng))
        for t in work_times(rng, start, days, home.utc, (lo, hi)):
            city, ip = (home, w.egress_ip if home is w.office else ip_home)
            if travel and travel[0] <= t < travel[1]:
                city, ip = travel[2], travel[3]
            apps = APPS if u.department == "IT" else APPS[:4]
            app = rng.choices(apps, weights=apps_w[: len(apps)])[0]
            if app[0] == "Azure Portal" or rng.random() < 0.08:
                signin(ds, w, rng, t, u, ip, city, app, "50074", FAILURES[2][1], auth="multiFactorAuthentication")
                signin(ds, w, rng, t + dt.timedelta(seconds=rng.randint(8, 40)), u, ip, city, app,
                       auth="multiFactorAuthentication",
                       mfa={"authMethod": "Mobile app notification", "authDetail": "MFA completed in Azure AD"})
            elif rng.random() < 0.05:
                code, desc, _ = rng.choices(FAILURES, weights=[f[2] for f in FAILURES])[0]
                signin(ds, w, rng, t, u, ip, city, app, code, desc)
                signin(ds, w, rng, t + dt.timedelta(seconds=rng.randint(10, 90)), u, ip, city, app)
            else:
                signin(ds, w, rng, t, u, ip, city, app, interactive=rng.random() < 0.7)
        _endpoint(ds, w, rng, u, start, days, scale)
        _office(ds, w, rng, u, ip_home, start, days, scale)
    _identity(ds, w, start)
    _admin(ds, w, rng, start, days)
    _servers(ds, w, rng, start, end, days, scale)
    _firewall(ds, w, rng, start, days, scale)
    _syslog(ds, w, rng, start, end, scale)
    _ipgeo(ds, w)


def _endpoint(ds, w, rng, u, start, days, scale):
    for t in work_times(rng, start, days, u.city.utc, (max(2, int(6 * scale)), max(3, int(14 * scale)))):
        fname, folder = rng.choice(COMMON_PROCS)
        folder = folder.format(u=u.sam)
        parent = "explorer.exe" if fname not in ("svchost.exe", "conhost.exe", "taskhostw.exe") else "services.exe"
        ds.add("DeviceProcessEvents", Timestamp=t, DeviceId=u.device_id, DeviceName=u.device.lower(),
               ActionType="ProcessCreated", FileName=fname, FolderPath=f"{folder}\\{fname}",
               SHA256=stable_hex("bin", fname), ProcessId=rng.randint(1000, 30000),
               ProcessCommandLine=f'"{fname}"', AccountDomain=w.domain.split(".")[0], AccountName=u.sam,
               AccountUpn=u.upn, InitiatingProcessFileName=parent,
               InitiatingProcessFolderPath=r"C:\Windows" + ("\\" if parent == "explorer.exe" else r"\System32" + "\\") + parent,
               InitiatingProcessCommandLine=parent, InitiatingProcessId=rng.randint(500, 9000),
               InitiatingProcessAccountName=u.sam if parent == "explorer.exe" else "system",
               InitiatingProcessParentFileName="userinit.exe" if parent == "explorer.exe" else "wininit.exe")
        if rng.random() < 0.6:
            host = rng.choice(WEB).format(d=w.domain, s=w.domain.split(".")[0])
            ds.add("DeviceNetworkEvents", Timestamp=t + dt.timedelta(seconds=rng.randint(1, 600)), DeviceId=u.device_id,
                   DeviceName=u.device.lower(), ActionType="ConnectionSuccess",
                   RemoteIP=f"192.0.2.{rng.randint(1, 120)}" if not host.endswith(w.domain) else f"10.30.0.{rng.randint(10, 15)}",
                   RemotePort=443, RemoteUrl=host, LocalIP=u.device_ip, LocalPort=rng.randint(49152, 65000),
                   Protocol="Tcp", InitiatingProcessFileName=fname if fname.endswith(("chrome.exe", "msedge.exe", "teams.exe", "outlook.exe")) else "msedge.exe",
                   InitiatingProcessCommandLine=f'"{fname}"', InitiatingProcessAccountName=u.sam,
                   InitiatingProcessSHA256=stable_hex("bin", fname))


def _office(ds, w, rng, u, ip_home, start, days, scale):
    site = f"https://{w.domain.split('.')[0]}.sharepoint.com/sites/{u.department.lower()}"
    for t in work_times(rng, start, days, u.city.utc, (1, max(2, int(5 * scale)))):
        ip = w.egress_ip if u.city is w.office else ip_home
        if rng.random() < 0.5:
            doc = f"{rng.choice(['Q3', 'Q4', 'Plan', 'Rota', 'Budget', 'Notes'])}-{rng.randint(1, 40)}.{rng.choice(['docx', 'xlsx', 'pptx'])}"
            ds.add("OfficeActivity", TimeGenerated=t, TenantId=w.tenant_id, RecordType="SharePointFileOperation",
                   Operation=rng.choice(["FileAccessed", "FileModified", "FileDownloaded"]), OfficeWorkload="SharePoint",
                   UserId=u.upn, UserType="Regular", ClientIP=ip, ResultStatus="Succeeded",
                   OfficeObjectId=f"{site}/Shared Documents/{doc}", SourceFileName=doc,
                   SourceRelativeUrl="Shared Documents", Site_Url=site + "/", UserAgent=f"Mozilla/5.0 ({u.os})")
        else:
            ds.add("OfficeActivity", TimeGenerated=t, TenantId=w.tenant_id, RecordType="ExchangeItem",
                   Operation=rng.choice(["MailItemsAccessed", "Send", "MoveToDeletedItems"]), OfficeWorkload="Exchange",
                   UserId=u.upn, UserType="Regular", ClientIP=ip, ResultStatus="Succeeded", MailboxOwnerUPN=u.upn,
                   OfficeObjectId="", Parameters="[]")


def _identity(ds, w, start):
    for u in w.users:
        ds.add("IdentityInfo", TimeGenerated=start, AccountObjectId=u.user_id, AccountUPN=u.upn, AccountName=u.sam,
               AccountDisplayName=u.display, GivenName=u.first, Department=u.department, JobTitle=u.title,
               City=u.city.name, Country=u.city.country, AssignedRoles=u.roles, IsAccountEnabled=True)


def audit(ds, w, rng, t, op, actor, targets, category="UserManagement", result="success", service="Core Directory",
          actor_ip=None, details=None):
    ds.add("AuditLogs", TimeGenerated=t, TenantId=w.tenant_id, OperationName=op, ActivityDisplayName=op,
           Category=category, Result=result, ResultReason="", LoggedByService=service,
           InitiatedBy={"user": {"userPrincipalName": actor.upn, "id": actor.user_id, "ipAddress": actor_ip or w.egress_ip}},
           TargetResources=targets, AdditionalDetails=details or [], CorrelationId=stable_uuid(rng), Id=stable_uuid(rng))


def target_user(u, props=None):
    return {"id": u.user_id, "type": "User", "userPrincipalName": u.upn, "displayName": u.display,
            "modifiedProperties": props or []}


def _admin(ds, w, rng, start, days):
    it = [u for u in w.users if u.department == "IT"]
    for d in range(days):
        day = start + dt.timedelta(days=d, hours=9 - w.office.utc)
        if day.weekday() >= 5:
            continue
        for _ in range(rng.randint(2, 6)):
            actor, target = rng.choice(it), rng.choice(w.users)
            t = day + dt.timedelta(minutes=rng.randint(0, 480))
            op = rng.choice(["Reset user password", "Update user", "Add member to group", "Change user license"])
            props = ([{"displayName": "Group.DisplayName", "oldValue": None, "newValue": f'"{target.department} Team"'}]
                     if op == "Add member to group" else [])
            audit(ds, w, rng, t, op, actor, [target_user(target, props)],
                  category="GroupManagement" if "group" in op else "UserManagement")
        # Azure: normal resource operations by IT staff
        for _ in range(rng.randint(3, 10)):
            actor = rng.choice(it)
            t = day + dt.timedelta(minutes=rng.randint(0, 480))
            op, prov = rng.choice([("Microsoft.Compute/virtualMachines/start/action", "Microsoft.Compute"),
                                   ("Microsoft.Compute/virtualMachines/deallocate/action", "Microsoft.Compute"),
                                   ("Microsoft.Storage/storageAccounts/listKeys/action", "Microsoft.Storage"),
                                   ("Microsoft.Network/networkSecurityGroups/write", "Microsoft.Network"),
                                   ("Microsoft.Web/sites/restart/action", "Microsoft.Web")])
            rg = rng.choice(["rg-prod-app", "rg-prod-data", "rg-shared-net"])
            azure(ds, w, rng, t, op, prov, actor.upn, w.egress_ip, rg, f"res{rng.randint(1, 9)}")


def azure(ds, w, rng, t, op, prov, caller, ip, rg, name, status="Succeeded", props=None):
    rtype = op.rsplit("/", 2)[0] if op.count("/") >= 2 else op
    rid = f"/subscriptions/{w.subscription_id}/resourceGroups/{rg}/providers/{rtype}/{name}".upper()
    for phase in (["Started", status] if status == "Succeeded" else [status]):
        ds.add("AzureActivity", TimeGenerated=t, TenantId=w.tenant_id, OperationNameValue=op.upper(), OperationName=op,
               CategoryValue="Administrative", ActivityStatusValue=phase, Level="Informational", Caller=caller,
               CallerIpAddress=ip, SubscriptionId=w.subscription_id, ResourceGroup=rg.upper(),
               ResourceProviderValue=prov.upper(), _ResourceId=rid, Properties_d=props or {"eventCategory": "Administrative"},
               CorrelationId=stable_uuid(rng))
        t = t + dt.timedelta(seconds=rng.randint(2, 30))


def winevent(ds, w, t, computer, eid, **kw):
    acts = {4624: "4624 - An account was successfully logged on.", 4625: "4625 - An account failed to log on.",
            4634: "4634 - An account was logged off.", 4672: "4672 - Special privileges assigned to new logon.",
            4688: "4688 - A new process has been created.", 4720: "4720 - A user account was created.",
            4732: "4732 - A member was added to a security-enabled local group.",
            4740: "4740 - A user account was locked out."}
    lt = kw.get("LogonType")
    names = {2: "2 - Interactive", 3: "3 - Network", 5: "5 - Service", 10: "10 - RemoteInteractive"}
    ds.add("SecurityEvent", TimeGenerated=t, Computer=f"{computer}.{w.domain}", EventID=eid, Activity=acts[eid],
           Channel="Security", Level="8" if eid != 4625 else "16", LogonTypeName=names.get(lt), **kw)


def _servers(ds, w, rng, start, end, days, scale):
    dom = w.domain.split(".")[0].upper()
    for name, ip, _ in w.servers:
        for t in work_times(rng, start, days, w.office.utc, (int(20 * scale), int(40 * scale))):
            u = rng.choice(w.users)
            winevent(ds, w, t, name, 4624, Account=f"{dom}\\{u.sam}", AccountType="User", TargetUserName=u.sam,
                     TargetDomainName=dom, LogonType=3, IpAddress=u.device_ip, IpPort="0",
                     WorkstationName=u.device, Status="0x0", SubStatus="0x0")
            winevent(ds, w, t + dt.timedelta(minutes=rng.randint(1, 50)), name, 4634, Account=f"{dom}\\{u.sam}",
                     AccountType="User", TargetUserName=u.sam, TargetDomainName=dom, LogonType=3)
            if rng.random() < 0.04:   # typo'd password
                winevent(ds, w, t - dt.timedelta(seconds=20), name, 4625, Account=f"{dom}\\{u.sam}", AccountType="User",
                         TargetUserName=u.sam, TargetDomainName=dom, LogonType=3, IpAddress=u.device_ip,
                         WorkstationName=u.device, Status="0xc000006d", SubStatus="0xc000006a")
        # scheduled service logons and routine processes, all day long
        t = start
        while t < end:
            winevent(ds, w, t, name, 4624, Account="NT AUTHORITY\\SYSTEM", AccountType="Machine", TargetUserName="SYSTEM",
                     TargetDomainName="NT AUTHORITY", LogonType=5, IpAddress="-", Status="0x0")
            proc = rng.choice([r"C:\Windows\System32\svchost.exe", r"C:\Windows\System32\wbem\WmiPrvSE.exe",
                               r"C:\Windows\System32\taskhostw.exe", r"C:\Windows\System32\backgroundTaskHost.exe"])
            winevent(ds, w, t + dt.timedelta(seconds=5), name, 4688, Account="NT AUTHORITY\\SYSTEM", AccountType="Machine",
                     SubjectUserName=f"{name}$", NewProcessName=proc, Process=proc.rsplit("\\", 1)[1],
                     ParentProcessName=r"C:\Windows\System32\services.exe", CommandLine=proc)
            t += dt.timedelta(minutes=rng.randint(int(25 / scale) or 1, int(70 / scale) or 2))


def _firewall(ds, w, rng, start, days, scale):
    v, p, ver = FW_VENDOR
    for t in work_times(rng, start, days, w.office.utc, (int(300 * scale), int(500 * scale))):
        u = rng.choice(w.users)
        host = rng.choice(WEB).format(d=w.domain, s=w.domain.split(".")[0])
        allow = rng.random() > 0.03
        ds.add("CommonSecurityLog", TimeGenerated=t, DeviceVendor=v, DeviceProduct=p, DeviceVersion=ver,
               DeviceEventClassID="traffic", Activity="TRAFFIC", LogSeverity="1" if allow else "4",
               DeviceAction="allow" if allow else "deny", ApplicationProtocol="ssl", SourceIP=u.device_ip,
               SourcePort=rng.randint(49152, 65000), DestinationIP=f"192.0.2.{rng.randint(1, 120)}",
               DestinationPort=443, Protocol="TCP", RequestURL=f"https://{host}/", SentBytes=rng.randint(400, 20000),
               ReceivedBytes=int(rng.lognormvariate(9, 1.5)), SourceUserName=u.upn, DeviceName="fw-edge-01",
               AdditionalExtensions=f"rule=web-out;zone=lan;cat={rng.choice(['business', 'news', 'cloud', 'collab'])}",
               Computer="fw-edge-01")
    # internet background: scans against the edge
    for d in range(days):
        for _ in range(int(rng.randint(20, 60) * scale)):
            t = start + dt.timedelta(days=d, seconds=rng.randint(0, 86399))
            ds.add("CommonSecurityLog", TimeGenerated=t, DeviceVendor=v, DeviceProduct=p, DeviceVersion=ver,
                   DeviceEventClassID="traffic", Activity="TRAFFIC", LogSeverity="3", DeviceAction="deny",
                   SourceIP=f"192.0.2.{rng.randint(130, 250)}", SourcePort=rng.randint(1024, 65000),
                   DestinationIP=w.egress_ip, DestinationPort=rng.choice([22, 23, 445, 3389, 8080, 5900]),
                   Protocol="TCP", SentBytes=60, ReceivedBytes=0, DeviceName="fw-edge-01",
                   AdditionalExtensions="rule=default-deny;zone=wan", Computer="fw-edge-01")


def _syslog(ds, w, rng, start, end, scale):
    for name, ip in w.linux_hosts:
        t = start
        while t < end:
            kind = rng.random()
            if kind < 0.4:
                fac, sev, proc, msg = "cron", "info", "CRON", f"(root) CMD (/usr/local/bin/backup.sh --quiet)"
            elif kind < 0.65:
                u = rng.choice(w.users[:8])
                fac, sev, proc = "authpriv", "info", "sshd"
                msg = f"Accepted publickey for {u.sam} from {u.device_ip} port {rng.randint(40000, 60000)} ssh2: ED25519 SHA256:{stable_hex(u.sam, n=20)}"
            elif kind < 0.8:
                u = rng.choice(w.users[:8])
                fac, sev, proc, msg = "authpriv", "notice", "sudo", f"{u.sam} : TTY=pts/0 ; PWD=/home/{u.sam} ; USER=root ; COMMAND=/usr/bin/systemctl status nginx"
            else:
                fac, sev, proc, msg = "daemon", "info", "systemd", "Started Daily apt download activities."
            ds.add("Syslog", TimeGenerated=t, Computer=name, HostName=name, HostIP=ip, Facility=fac, SeverityLevel=sev,
                   ProcessName=proc, ProcessID=rng.randint(300, 40000), SyslogMessage=msg)
            t += dt.timedelta(minutes=rng.randint(int(8 / scale) or 1, int(40 / scale) or 2))
        # opportunistic SSH scanning from the internet (always fails)
        bastion = w.linux_hosts[0]
        if name == bastion[0]:
            for _ in range(int(40 * scale)):
                t = start + dt.timedelta(seconds=rng.randint(0, int((end - start).total_seconds())))
                user = rng.choice(["admin", "test", "oracle", "ubuntu", "pi", "git"])
                ds.add("Syslog", TimeGenerated=t, Computer=name, HostName=name, HostIP=ip, Facility="authpriv",
                       SeverityLevel="info", ProcessName="sshd", ProcessID=rng.randint(300, 40000),
                       SyslogMessage=f"Failed password for invalid user {user} from 192.0.2.{rng.randint(130, 250)} port {rng.randint(30000, 65000)} ssh2")


def _ipgeo(ds, w):
    for c in w.cities + [w.hosting, w.scanner]:
        ds.add("IpGeo", Network=c.network, CountryOrRegion=c.country, City=c.name, Latitude=c.lat, Longitude=c.lon,
               Asn=c.asn, AsnOrg=c.asn_org, IsHosting=c.hosting)
    ds.add("IpGeo", Network="192.0.2.0/25", CountryOrRegion="US", City="Ashburn", Latitude=39.04, Longitude=-77.49,
           Asn=64650, AsnOrg="Example CDN and SaaS", IsHosting=True)
    o = w.office
    ds.add("IpGeo", Network="203.0.113.0/24", CountryOrRegion=o.country, City=o.name, Latitude=o.lat, Longitude=o.lon,
           Asn=64700, AsnOrg=f"{w.company} (corporate egress)", IsHosting=False)
