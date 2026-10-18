# Handoff: security operations (KQL lab engine)

The security-operations domain's KQL labs run on **KustoLoco**
(github.com/NeilMacMullen/kusto-loco, MIT), an in-memory KQL engine, in the learner
workstation image **`kql-ws:1`**. This stream built the engine, the image, the grading
helper and a seeded log generator. It did not write the curriculum or any lab.

## Status (2026-10-18)

- `kql-ws:1` builds (CI: `images.yml` matrix entry `kql-ws`, with Trivy, Grype and SBOMs;
  locally: `task image:build:kql-ws`). Size: 753 MB as Docker reports it (about 190 MB
  compressed). The largest layers: the self-contained lokql at 248 MB (.NET runtime,
  ReadyToRun, Magick.NET and SkiaSharp natives), the apt packages at 171 MB and the two
  datasets at 46 MB.
- KustoLoco is pinned to **v1.4.9** (`35eaf95`), plus **16 CloudTrain patches** in
  `tools/images/kql-ws/patches/` applied with `git am --keep-cr`. KustoLoco's own suites
  pass on the patched tree with the licence-clean profile: BasicTests 635, CoreTests 273,
  LokqlEngineTests 24. The image build runs them (`RUN_TESTS=1`).
- In the spike (50 SOC-analyst queries plus 60 probes), stock v1.4.9 answers 34 of the
  50 queries correctly. With the patches it answers 47; the 3 left use `top-nested`,
  `evaluate autocluster` and `evaluate pivot`. Every typical detection works.
- Nothing has been published upstream; the user decides (see "Upstream candidates").
- Not done: the curriculum and the labs (another agent). `packages/lab-schema` has no
  `security` domain yet (the `domain` enum); the curriculum agent adds it with the first lab.

## Engine choice

| Option | Outcome |
|---|---|
| Microsoft Kusto emulator | Out: its licence bars hosting it for learners. |
| Splunk | Out: same. |
| **KustoLoco** | **Chosen** (user decision): MIT, .NET, embeddable, extensible. The lokql CLI is the learner shell. |

KustoLoco's parser is Microsoft's **Kusto.Language**. Its NuGet package and the
Azure client packages lokql pulls in (`Microsoft.Azure.Kusto.Data`,
`Kusto.Cloud.Platform(.Msal)`) ship under the **Azure Data Explorer SDK licence
terms**. Those terms restrict redistribution (end-user terms, indemnity) and forbid
providing the software "as a stand-alone hosted solution for others to use". The image
therefore does not ship them:

- Kusto.Language is compiled from **github.com/microsoft/Kusto-Query-Language (Apache-2.0)**
  at `KUSTO_LANGUAGE_COMMIT` (`c94c9e7`, 2026-07-19), the source of the 12.4.1 package
  that v1.4.9 references.
  - Since 2026-07-08 that repo ships its generated sources (syntax nodes, command grammars)
    as T4 templates. `tools/images/kql-ws/kusto-language-codegen` calls the same generator
    classes the templates call.
  - Checked against the last committed generated files: the only differences are commands
    added since then.
- `LokqlAzureConnectors=false` builds lokql without `.adx`, `.loganalytics`, `.appinsights`,
  `.arg` and `.defender`; lab VMs have no internet anyway.
- `licences/collect-nuget-licences.py` fails the build if a package with that EULA is
  published, or if a package declares no licence at all.
- Both switches are patch 16 ("build: licence-clean profile"). Upstream defaults are
  unchanged.

## Gap table

From the spike: `tools/images/kql-ws/spike/` (`run.py` runs inside the image; the
patched build's results are in `results.json`). The data comes from `ct-loggen` (seed `lab-42`) plus the Sentinel
sample tables. Each query has an automatic check against the generator's answers or a
known KQL result.

**works** = right result. **wrong** = runs, wrong result. **unsupported** = error.

| Feature | v1.4.9 | patched | Patch / note |
|---|---|---|---|
| where, summarize, count/countif/dcountif, percentile | works | works | |
| `bin`, `bin_at`, timechart data | works | works | |
| `render` in a script (no terminal) | **wrong**: the sixel probe throws, and `.save` writes the previous query's rows | works (the chart's data is shown as a table) | 2 |
| join inner/leftanti/fullouter, multi-key, time window | works | works | |
| `lookup`, `evaluate ipv4_lookup` | works | works | |
| `parse` (simple, regex, relaxed, typed captures) | unsupported | works | 8 |
| `parse-where`, `parse-kv` | unsupported | unsupported | gap |
| `extract`, `extract_all`, `parse_url`, `split` | works | works | |
| `parse_json` + dot/bracket access on dynamic | works | works | |
| `todynamic()` | unsupported | works | 4 |
| dynamic literals with single quotes, `dynamic(['a','b'])` | unsupported | works | 3 |
| let (scalar, tabular, function), `datatable`, `materialize()`, `toscalar` | works | works | |
| `arg_max`/`arg_min`, `dcount`, `make_set`/`make_list`(`_if`) | works | works | |
| `percentiles()` (plural) | unsupported | unsupported | gap: use `percentile()` per value |
| `stdev`, `variance` (+`if`, `p`) | unsupported | works | 6 |
| `top-nested` | unsupported | unsupported | gap |
| `mv-expand` (incl. `with_itemindex`, `bagexpansion`) | works | works | |
| `mv-expand x to typeof(datetime)` over a make-series axis | **wrong** (null) | works | 11 |
| `mv-apply` (where / summarize inside) | works | works | |
| `make-series` without `from`/`to` | unsupported | works | 9 |
| `series_decompose_anomalies`, `series_decompose`, `series_stats(_dynamic)`, `series_fit_line`, `series_outliers` | unsupported | works (approximate scores, see below) | 10 |
| `series_fir`/`series_iir`, `series_periods_*` | unsupported | unsupported | gap |
| `evaluate bag_unpack` (prefix, conflict modes, typed schema) | unsupported | works | 14 |
| `evaluate autocluster`, `basket`, `pivot`, `narrow` | unsupported | unsupported | gap |
| `search` (all tables, `in (...)`, column-scoped, wildcards, piped) | unsupported | works | 13 |
| `union T*` wildcards | unsupported | works | 12 |
| `union withsource=` | **wrong** (empty source column) | works | 12 |
| `union isfuzzy=true` + `column_ifexists` | unsupported (column_ifexists was a stub) | works | 4, 12 |
| `has`, `!has`, `has_any`, `has_all` | **wrong** (substring match: "PowerShell" has "shell") | works (term match) | 5 |
| `hasprefix`, `hassuffix` (+`_cs`, negated) | unsupported | works | 5 |
| `replace_regex`, `replace` | unsupported | works | 4 |
| `base64_decode_toarray`, `unicode_codepoints_to/from_string` | unsupported | works | 4 |
| `hourofday` | unsupported | works | 4 |
| `extend` after a datetime `range` | unsupported (index error) | works | 15 |
| `ipv4_is_in_range`, `ipv4_is_private`, `ipv4_is_in_any_range`, `parse_ipv4` | works | works | |
| `geo_distance_2points` + `prev()` (impossible travel) | works | works | |
| `geo_info_from_ip_address` | wrong (null) until `.loadgeoip` | works after `.loadgeoip` | country level only (DB-IP Lite); lab data uses the IpGeo lookup table instead |
| `row_cumsum` | unsupported | unsupported | gap |
| `sample`, `as`, `facet`, `invoke`, `fork` | unsupported | unsupported | gap |
| `gettype`, `parse_command_line`, `extract_json`, `ingestion_time` | unsupported | unsupported | gap |
| Detections: brute force then success (Entra and 4625->4624), MFA fatigue, new Global Administrator, impossible travel, rare process, beaconing (stdev/avg of gaps), spray fingerprint | works except beaconing (needs stdev) | all work | |
| Failed query in a script | **wrong**: exit 0; a later `.materialize` replaced the table with an empty one | exit 1; `.materialize` and `.save` refuse | 2, 7 |
| Values containing `[` in the table output | **wrong**: render error, result lost | works | 1 |

Remaining gaps that matter for labs, most important first:

1. `top-nested` and `evaluate pivot`: used in some hunting queries. Labs can use
   `summarize` + `top` / `make_bag` instead.
2. `percentiles()` and `row_cumsum`: write `percentile()` per value, or `serialize` +
   `prev()`.
3. `autocluster`/`basket`: no lab should rely on them yet.
4. `parse-kv`: use `extract` or `parse`.

### Approximations to keep in mind when authoring

- **`series_decompose_anomalies` / `series_outliers`.** The flags for clear anomalies match
  ADX; scores and baselines are close, not identical. Seasonality is detected with
  autocorrelation, not ADX's periodogram. **Grade on the flagged timestamps, never on
  scores.**
- **`has`.** It matches terms of letters and digits. Kusto tokenizer edge cases (Unicode
  categories) may differ.
- **`bag_unpack` without a schema.** Columns appear in first-seen key order and are typed
  dynamic. Use `tostring()` before comparing strings, or pass a typed schema
  (`evaluate bag_unpack(x) : (a:string, b:long)`).
- **`search`.** A bare term is `has` over string and dynamic columns. A predicate cannot
  use let-bound scalars.

## Patches (`tools/images/kql-ws/patches/`)

All patches are on a local branch in a scratch clone, written in the project's style with
tests in its suites. Exported with `git format-patch`. Patches 1-15 are candidates for an
upstream contribution; 16 is CloudTrain-specific.

| # | Patch | Tests |
|---|---|---|
| 1 | lokql: escape Spectre markup in table output | (renders) |
| 2 | lokql: make scripted runs trustworthy (result kept before rendering, no sixel without a terminal, error count, exit 1 on errors, `.materialize` refuses failures, failed `.load` is an error, ISO datetimes, `.echo` prints all words) | LokqlEngineTests +4 |
| 3 | core: accept Kusto dynamic literal syntax | +5, CoreTests 1 updated |
| 4 | core: add todynamic, replace_regex/replace, base64_decode_toarray, unicode_codepoints_*, column_ifexists; fix hourofday | +10 |
| 5 | core: term semantics for has/has_any/has_all; add hasprefix/hassuffix | +5, 3 updated |
| 6 | core: add stdev, variance and their p/if forms | +4 |
| 7 | lokql: `--quiet` startup; `.save` writes empty results and refuses failed ones | LokqlEngineTests +2 |
| 8 | core: add the parse operator | +12 |
| 9 | core: make-series infers from/to when omitted | +4 |
| 10 | core: add series_stats, series_fit_line, series_outliers, series_decompose(_anomalies) (with tuple-returning functions) | +10 |
| 11 | core: typed mv-expand converts datetime/timespan elements; todatetime(dynamic) | +4 |
| 12 | core: union table wildcards and withsource | +9 |
| 13 | core: add the search operator | +13 |
| 14 | core: add evaluate bag_unpack | +7 |
| 15 | core: extend after a datetime range | +2 |
| 16 | build: licence-clean profile (Kusto.Language from source, no Azure connectors) | (build) |

To change a patch: clone KustoLoco and check out `KUSTOLOCO_COMMIT`, then
`git am --keep-cr tools/images/kql-ws/patches/*.patch`. Edit, commit, and re-export with
`git format-patch --zero-commit --no-signature -o tools/images/kql-ws/patches
<commit>..HEAD`. The patches keep CRLF lines (`patches/.gitattributes`: `-text`).

To bump KustoLoco: change `KUSTOLOCO_VERSION`/`KUSTOLOCO_COMMIT` (and
`KUSTO_LANGUAGE_COMMIT` to the source of the package it references) in
`deploy/versions.env`, rebase the patches, and rebuild. Run builds on ct-testvm, not the
local machine.

### Upstream candidates (user decides; nothing is published)

- **Patches 1-15.** Each stands alone and has tests.
- **Patches 3 and 5 change behaviour.** 3 makes loose dynamic literals parse instead of
  throw. 5 changes `has` from substring to term matching and updates three upstream tests
  that asserted the substring behaviour.
- **Patch 16** could be offered as an opt-in build profile, but it exists for CloudTrain's
  licensing.

## The image (`kql-ws:1`)

| Path | What |
|---|---|
| `/opt/cloudtrain/kql/lokql/lokql` | the patched lokql (self-contained .NET 10); also `lokql` on PATH |
| `/usr/local/bin/kql` | learner shell: `kql` (prompt with the lab's tables), `kql -c 'Q'`, `kql -f file.kql`, `kql --tables`, `kql --sample` |
| `/usr/local/bin/ct-kql` | grading helper, below |
| `/usr/local/bin/kql-load` | prints the lokql script that loads a dataset with its schema types |
| `/usr/local/bin/ct-loggen` | the generator, below |
| `/opt/cloudtrain/kql/datasets/demo` | a fixed ct-loggen dataset (seed `demo`), the default outside a lab |
| `/opt/cloudtrain/kql/datasets/sentinel-sample` | Azure-Sentinel sample tables: CommonSecurityLog (FortiGate, PAN-OS, Firepower CEF), Syslog (WatchGuard), SecurityEvent (4663 file auditing); loaded as `Sample_<Table>` with `--sample` |
| `/srv/kql/lab` | the lab's dataset (setup writes it as root; learner-readable) |
| `/var/lib/cloudtrain/kql/` | root only (0700): the generator's answers |
| `/usr/share/doc/cloudtrain-kql/` | licence notices (below) |

**Datasets.** A dataset is a directory with `schema.json` (tables, files and KQL column
types) and one JSONL file per table. lokql's own type inference turns `"0"` into a long
and nested objects into strings, so `kql-load` loads each file without inference, casts
every column to its schema type (dynamic columns through `todynamic`) and materializes the
result under the table's name. Loading the default dataset (16k rows) takes about 2 s.

**User.** `learner` (uid 1000, no sudo). The pod needs no privileges. Give the workstation
`resources: { cpu: 1, memoryMiB: 1024 }`.

## Data sources

| Source | Licence | Used as |
|---|---|---|
| Azure/Azure-Sentinel "Sample Data" @ `4aee8b8` | MIT (keep the notice) | `sentinel-sample` dataset; files and sha256 in `sample-data/sources.lock`, normalised by `sample-data/import.py` (first 5000 rows of the large files, empty columns dropped, ISO datetimes) |
| synthetic, `ct-loggen` | CloudTrain | every lab's own data |
| splunk/attack_data | Apache-2.0 | not imported yet: labs that need Sysmon/Windows event raw logs can add a lock file the same way |
| BOTS v1-v3 | CC0 | not imported yet; never use the "BOTS" name in content |

The Sentinel sample data has **no** SigninLogs, AuditLogs, AzureActivity,
OfficeActivity or Device* tables. Those come only from `ct-loggen`.

## The generator (`ct-loggen`)

Code: `tools/images/kql-ws/loggen/` (stdlib Python, 14 unit tests run in the image build).

```
ct-loggen generate --seed SEED --out DIR [--scenario identity-compromise|none]
                   [--end ISO] [--days 7] [--users 60] [--scale 1.0] [--format jsonl|csv]
                   [--answers FILE]          # mode 0600
ct-loggen answers  --seed SEED [same options]  # the answers as JSON, nothing written
ct-loggen list
```

**Determinism.** The same seed and options give byte-identical data and answers; different
seeds give different people, addresses, hosts, times and answers. The seed is never
written into DIR.

**World.**
- A fictional company: name, `<slug>.example` domain, 60 users with departments and
  roles, laptops, Windows servers and Linux hosts.
- Cities with coordinates.
- Addresses only from reserved ranges:
  - `10/8` internal;
  - `203.0.113/24` corporate egress;
  - `198.18/15` the "internet", one /24 per city;
  - `198.51.100/24` a hosting provider;
  - `192.0.2/24` SaaS and scanners.
- The **IpGeo** lookup table maps every range to city, country, ASN and hosting flag
  (`evaluate ipv4_lookup(IpGeo, IP, Network)`), since `geo_info_from_ip_address` knows
  none of these addresses.

**Tables** (Sentinel-shaped subsets of the real columns): SigninLogs, AuditLogs,
AzureActivity, OfficeActivity, SecurityEvent, DeviceProcessEvents, DeviceNetworkEvents,
CommonSecurityLog, Syslog, IdentityInfo, IpGeo.

**Noise** (with deliberate false positives):
- working-hours sign-ins, wrong passwords and MFA prompts, a legitimate traveller;
- admin activity in Entra and Azure;
- common processes and web traffic;
- server logons and service processes;
- firewall allow/deny and internet scans;
- cron, sudo and ssh in Syslog.

**Scenario `identity-compromise`** (one per dataset, times relative to `--end`):
1. Password spray from a VPS.
2. MFA fatigue (9-24 push denials, then an approval at night).
3. Impossible travel against the victim's last sign-in.
4. The victim registers a new MFA method, creates a backdoor account and adds it to
   Global Administrator.
5. The backdoor takes Owner and creates VMs in a new resource group.
6. An inbox rule forwards mail outside.
7. A burst of SharePoint downloads.
8. Phish to `powershell -enc` to a dropped binary (one device, one hash) that beacons every
   5-20 min with jitter.
9. Brute force from the laptop against the file server (4625 x N, then 4624), and a new
   local admin.

**Answers.** `victim_upn`, `spray_ip`, `spray_failed_accounts`, `attacker_login_ip`,
`mfa_denials`, `compromise_time`, `backdoor_upn`, `role_assigned`, `inbox_rule_name`,
`forward_to`, `files_downloaded`, `implant_file`, `implant_sha256`, `c2_host`, `c2_ip`,
`beacon_interval_s`, `beacon_count`, `bruteforce_account`, `bruteforce_failures`,
`local_admin_created`, and more. The unit tests check that the answers are what a correct
query over the data returns.

**Adding a scenario.** Add a module to `ctloggen/scenarios/` (`NAME`, `DESCRIPTION`,
`generate(ds, world, start, end) -> answers`), register it in `scenarios/__init__.py`, and
add story tests. CTF challenges use the same pattern: one scenario per story, the flag in
the answers.

## How to author a KQL lab

```yaml
spec:
  params:
    seed: { type: int, min: 100000, max: 999999999 }
  topology:
    entry: soc-ws
    nodes:
      - { name: soc-ws, driver: container, image: kql-ws:1, access: [shell],
          resources: { cpu: 1, memoryMiB: 1024 } }
  setup:
    - on: soc-ws
      run: |
        ct-loggen generate --seed {{seed}} --out /srv/kql/lab \
          --answers /var/lib/cloudtrain/kql/answers.json
        install -d -o learner -g learner /home/learner/answers
  checks:
    - id: victim
      description: The compromised account is in ~/answers/victim.txt
      type: shell
      on: soc-ws
      skills: [...]
      command: |
        [ "$(tr -d ' \n' < /home/learner/answers/victim.txt)" = "$(ct-kql answer victim_upn)" ] && echo ok
      expect: { match: exact, value: ok }
```

- **Seed and answers.** The seed is a param, so every attempt (and exam draw) gets its own
  data. Never print it or write it where the learner can read it: anyone with the seed can
  run `ct-loggen answers`.
- **Data window.** Without `--end` it ends at the hour of setup. Pass `--end` only if the
  lab needs fixed dates (warm pools set up ahead of time: the window then ends at
  pool-fill time, so word tasks as "in the last 7 days of the data", not "today").
- **Volume.** Keep the defaults (about 16k rows, under 2 s to load). `--scale 3` for
  hunting labs; above that, interactive startup slows.
- **Sample tables.** Labs on the sample data use `kql --sample` / `ct-kql --sample` and
  the `Sample_` table names.
- **What learners do.** They run `kql`, save queries to files (`~/answers/*.kql`) and
  results with `.save ~/answers/x.csv`.

## How graders query (`ct-kql`)

Lab checks run as root; `ct-kql` runs every query **as the learner**, and reads the
`-f` files as the learner. lokql can run programs (`.exec`) and read files
(`externaldata`), so a learner query can never see what the learner cannot, such as the
answers. Lines starting with `.` (lokql commands) are refused.

| Command | Prints |
|---|---|
| `ct-kql query [--format json\|csv\|table] (Q \| -f FILE)` | the result |
| `ct-kql scalar (Q \| -f FILE)` | the first cell of the first row (`""` if none) |
| `ct-kql count (Q \| -f FILE)` | the number of rows |
| `ct-kql compare [--ordered] [--columns] (Q \| -f FILE) EXPECTED_Q` | `match` or `mismatch: <why>` (rows as multisets, numbers to 1e-9, column names ignored unless `--columns`) |
| `ct-kql answer KEY` | a value from `/var/lib/cloudtrain/kql/answers.json` |

- **Options.** `--data DIR` (repeatable; default the lab dataset), `--sample`,
  `--timeout S` (default 25; shell checks time out at 30).
- **Errors.** A failed query prints `error: <message>` and exits 1, so `expect: exact`
  checks fail with a readable reason.
- **Speed.** One call loads the dataset once (about 3 s with startup). Put several
  questions in one check when speed matters.

Typical checks:

```sh
# the learner's query finds exactly the right rows (same as the reference solution)
ct-kql compare -f /home/learner/answers/mfa.kql \
  'SigninLogs | where ResultType == "500121" | summarize n=count() by UserPrincipalName | where n >= 5 | project UserPrincipalName'
# a value the learner reported
[ "$(cat /home/learner/answers/c2.txt)" = "$(ct-kql answer c2_host)" ] && echo ok
# the learner's query returns the beacon host in its first cell (values are seeded, so
# compare with the answer rather than a literal)
[ "$(ct-kql scalar -f /home/learner/answers/beacon.kql)" = "$(ct-kql answer c2_host)" ] && echo ok
```

## Licence notices

`/usr/share/doc/cloudtrain-kql/` in the image:

| File | Covers |
|---|---|
| `NOTICE` | the summary, below |
| `kusto-loco-LICENSE` | KustoLoco: MIT |
| `kusto-loco-patches.txt` | the CloudTrain modifications |
| `kustoloco-geo-NOTICE` | the DB-IP Lite country data, CC-BY-4.0: "IP Geolocation by DB-IP (https://db-ip.com)" |
| `kustoloco-useragent-NOTICE` | ua-parser/uap-core regexes, Apache-2.0 |
| `kusto-language-LICENSE` | Kusto.Language source: Apache-2.0 |
| `nuget/` | every NuGet package of lokql (99 packages: MIT, Apache-2.0, BSD, MS-PL OR Apache-2.0; no copyleft), with `packages.tsv` |
| `azure-sentinel-LICENSE` | the sample data: MIT, Microsoft |

Two packages declare no licence in their nuspec: ShapeCrawler and VegaGenerator. Both are
MIT; their repository LICENSE files at the packaged commits are vendored in
`licences/overrides/`.

The generator's data is synthetic: every name, company, host and address is fictional.

## Next steps

1. The curriculum agent writes the SOC path and labs (and adds `security` to the lab
   schema's `domain` enum). The first lab should be verified on the remote verify VM.
2. If labs need them: `top-nested`, `evaluate pivot`, `percentiles`, `row_cumsum`.
3. More scenarios for ct-loggen: ransomware precursor (Sysmon-style process trees), cloud
   key leak (AzureActivity), insider exfiltration. Optionally an attack_data import
   (Apache-2.0) for Windows raw-log labs.
4. Decide upstream publishing of patches 1-15 (user).
