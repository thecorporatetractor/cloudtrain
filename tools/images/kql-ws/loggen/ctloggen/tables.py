"""Sentinel-shaped table schemas (a useful subset of each real table's columns) and the
writer. Column types are KQL types; `schema.json` beside the data records them so the
loader (kql-load) casts every column to its real type, including dynamic ones.
"""
from __future__ import annotations

import csv
import datetime as dt
import json
import os

S, D, L, I, R, B, T = "string", "dynamic", "long", "int", "real", "bool", "datetime"

SCHEMAS: dict[str, list[tuple[str, str]]] = {
    "SigninLogs": [
        ("TimeGenerated", T), ("TenantId", S), ("UserPrincipalName", S), ("UserDisplayName", S), ("UserId", S),
        ("AppDisplayName", S), ("AppId", S), ("ResourceDisplayName", S), ("IPAddress", S), ("Location", S),
        ("LocationDetails", D), ("ResultType", S), ("ResultDescription", S), ("Status", D), ("DeviceDetail", D),
        ("ClientAppUsed", S), ("UserAgent", S), ("ConditionalAccessStatus", S), ("AuthenticationRequirement", S),
        ("MfaDetail", D), ("RiskLevelDuringSignIn", S), ("IsInteractive", B), ("CorrelationId", S), ("Type", S)],
    "AuditLogs": [
        ("TimeGenerated", T), ("TenantId", S), ("OperationName", S), ("Category", S), ("Result", S),
        ("ResultReason", S), ("LoggedByService", S), ("ActivityDisplayName", S), ("InitiatedBy", D),
        ("TargetResources", D), ("AdditionalDetails", D), ("CorrelationId", S), ("Id", S), ("Type", S)],
    "AzureActivity": [
        ("TimeGenerated", T), ("TenantId", S), ("OperationNameValue", S), ("OperationName", S),
        ("CategoryValue", S), ("ActivityStatusValue", S), ("Level", S), ("Caller", S), ("CallerIpAddress", S),
        ("SubscriptionId", S), ("ResourceGroup", S), ("ResourceProviderValue", S), ("_ResourceId", S),
        ("Properties_d", D), ("CorrelationId", S), ("Type", S)],
    "OfficeActivity": [
        ("TimeGenerated", T), ("TenantId", S), ("RecordType", S), ("Operation", S), ("OfficeWorkload", S),
        ("UserId", S), ("UserType", S), ("ClientIP", S), ("ResultStatus", S), ("OfficeObjectId", S),
        ("MailboxOwnerUPN", S), ("Parameters", S), ("SourceFileName", S), ("SourceRelativeUrl", S),
        ("Site_Url", S), ("UserAgent", S), ("Type", S)],
    "SecurityEvent": [
        ("TimeGenerated", T), ("Computer", S), ("EventID", I), ("Activity", S), ("Channel", S), ("Level", S),
        ("Account", S), ("AccountType", S), ("TargetUserName", S), ("TargetDomainName", S), ("SubjectUserName", S),
        ("LogonType", I), ("LogonTypeName", S), ("IpAddress", S), ("IpPort", S), ("WorkstationName", S),
        ("Status", S), ("SubStatus", S), ("Process", S), ("NewProcessName", S), ("ParentProcessName", S),
        ("CommandLine", S), ("MemberName", S), ("TargetAccount", S), ("Type", S)],
    "DeviceProcessEvents": [
        ("TimeGenerated", T), ("Timestamp", T), ("DeviceId", S), ("DeviceName", S), ("ActionType", S),
        ("FileName", S), ("FolderPath", S), ("SHA256", S), ("ProcessId", L), ("ProcessCommandLine", S),
        ("AccountDomain", S), ("AccountName", S), ("AccountUpn", S), ("InitiatingProcessFileName", S),
        ("InitiatingProcessFolderPath", S), ("InitiatingProcessCommandLine", S), ("InitiatingProcessId", L),
        ("InitiatingProcessAccountName", S), ("InitiatingProcessParentFileName", S), ("Type", S)],
    "DeviceNetworkEvents": [
        ("TimeGenerated", T), ("Timestamp", T), ("DeviceId", S), ("DeviceName", S), ("ActionType", S),
        ("RemoteIP", S), ("RemotePort", I), ("RemoteUrl", S), ("LocalIP", S), ("LocalPort", I), ("Protocol", S),
        ("InitiatingProcessFileName", S), ("InitiatingProcessCommandLine", S), ("InitiatingProcessAccountName", S),
        ("InitiatingProcessSHA256", S), ("Type", S)],
    "CommonSecurityLog": [
        ("TimeGenerated", T), ("DeviceVendor", S), ("DeviceProduct", S), ("DeviceVersion", S),
        ("DeviceEventClassID", S), ("Activity", S), ("LogSeverity", S), ("DeviceAction", S), ("ApplicationProtocol", S),
        ("SourceIP", S), ("SourcePort", I), ("DestinationIP", S), ("DestinationPort", I), ("Protocol", S),
        ("RequestURL", S), ("SentBytes", L), ("ReceivedBytes", L), ("SourceUserName", S), ("DeviceName", S),
        ("AdditionalExtensions", S), ("Computer", S), ("Type", S)],
    "Syslog": [
        ("TimeGenerated", T), ("Computer", S), ("HostName", S), ("HostIP", S), ("Facility", S),
        ("SeverityLevel", S), ("ProcessName", S), ("ProcessID", I), ("SyslogMessage", S), ("Type", S)],
    "IdentityInfo": [
        ("TimeGenerated", T), ("AccountObjectId", S), ("AccountUPN", S), ("AccountName", S),
        ("AccountDisplayName", S), ("GivenName", S), ("Department", S), ("JobTitle", S), ("City", S),
        ("Country", S), ("AssignedRoles", D), ("IsAccountEnabled", B), ("Type", S)],
    # Lookup table (not a Sentinel table): geo and ownership for every range in the dataset.
    "IpGeo": [
        ("Network", S), ("CountryOrRegion", S), ("City", S), ("Latitude", R), ("Longitude", R),
        ("Asn", L), ("AsnOrg", S), ("IsHosting", B)],
}


def iso(t: dt.datetime) -> str:
    return t.astimezone(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.") + f"{t.microsecond // 1000:03d}Z"


def _cell(v, kind):
    if v is None:
        return None
    if kind == T:
        return iso(v) if isinstance(v, dt.datetime) else v
    return v


class Dataset:
    def __init__(self):
        self.rows: dict[str, list[dict]] = {name: [] for name in SCHEMAS}

    def add(self, table: str, **cols):
        schema = SCHEMAS[table]
        known = {c for c, _ in schema}
        unknown = set(cols) - known
        if unknown:
            raise KeyError(f"{table}: unknown columns {sorted(unknown)}")
        if "Type" in known:
            cols.setdefault("Type", table)
        if table.startswith("Device") and "Timestamp" in cols:
            cols.setdefault("TimeGenerated", cols["Timestamp"])
        self.rows[table].append(cols)

    def write(self, out: str, fmt: str = "jsonl", tables=None):
        os.makedirs(out, exist_ok=True)
        schema_doc = {"tables": {}}
        for name, schema in SCHEMAS.items():
            if tables and name not in tables:
                continue
            rows = sorted(self.rows[name], key=lambda r: (r.get("TimeGenerated") or dt.datetime.min.replace(tzinfo=dt.timezone.utc)))
            schema_doc["tables"][name] = {"file": f"{name}.{fmt}", "rows": len(rows),
                                          "columns": [{"name": c, "type": k} for c, k in schema]}
            path = os.path.join(out, f"{name}.{fmt}")
            if fmt == "jsonl":
                with open(path, "w", encoding="utf-8") as f:
                    for r in rows:
                        f.write(json.dumps({c: _cell(r.get(c), k) for c, k in schema}, separators=(",", ":")) + "\n")
            elif fmt == "csv":
                with open(path, "w", encoding="utf-8", newline="") as f:
                    w = csv.writer(f)
                    w.writerow([c for c, _ in schema])
                    for r in rows:
                        line = []
                        for c, k in schema:
                            v = _cell(r.get(c), k)
                            line.append("" if v is None else json.dumps(v, separators=(",", ":")) if k == D
                                        else str(v).lower() if k == B else v)
                        w.writerow(line)
            else:
                raise ValueError(f"unknown format {fmt}")
        with open(os.path.join(out, "schema.json"), "w", encoding="utf-8") as f:
            json.dump(schema_doc, f, indent=1)
        return schema_doc
