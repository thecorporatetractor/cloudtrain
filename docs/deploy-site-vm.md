# The public website on one small VM

How to run the coming-soon website for `cloudtrain.app` (the static site, the
waitlist form and the public data API) on one small Linux VM, for about $7 to $13 a
month. The files are in [`deploy/site-vm/`](../deploy/site-vm/). Other hosts for the same
static build are in [deploy-website.md](deploy-website.md). Mail for the domain is in
[email.md](email.md).

The VM serves the website only. The platform (sign-in, labs, exams, billing) is not on
it: it needs a Kubernetes cluster ([deploy.md](deploy.md)) and gets its own host name
(`app.cloudtrain.app`) later.

## What runs on the VM

| Container | Role | Memory (measured, idle) | Limit |
|---|---|---|---|
| `caddy` | TLS (Let's Encrypt, renewed automatically), serves `site/`, sends `/api/public/*` to the gateway, answers 404 for every other `/api/*` path, redirects `www` to the apex | 15 MB | 96 MB |
| `gateway` | The CloudTrain gateway image in site-only use: public site data, catalog, waitlist | 140 MB | 320 MB |
| `postgres` | Postgres 18, the waitlist table (and the empty platform schema) | 60 MB | 192 MB |
| `migrate` | One-shot: applies the schema migrations, then exits | | |

About 215 MB in total, so a 1 GB instance has room for the OS and Docker. Measured on
2026-10-24 with the gateway image from `main` at `6cd28b78`.

Site-only use is a configuration, not a separate build. The gateway still starts its
OIDC client and its Kubernetes client, so `compose.yaml` gives it a placeholder client
secret and an unroutable kubeconfig context (`kubeconfig-none.yaml`), and turns the
attempt sweep off (`CT_SWEEP_INTERVAL_MS=0`). Neither client is ever used, because
Caddy forwards only `/api/public/*`. The admin export
`GET /api/platform/waitlist.csv` needs sign-in, so on this VM you export the
waitlist with `psql` instead (see Operations).

## Choosing the VM

The gateway image is published for `linux/amd64` only, so ARM instances (AWS `t4g`,
Azure `B*p*`) do not work. Prices are pay-as-you-go list prices from October 2026.
Check them in the provider's calculator for the region you pick.

| | AWS Lightsail Micro (recommended) | Azure `Standard_B2ats_v2` | AWS Lightsail Nano |
|---|---|---|---|
| CPU, memory | 2 vCPU (burstable), 1 GB | 2 vCPU (burstable), 1 GB | 2 vCPU (burstable), 0.5 GB |
| Disk | 40 GB SSD, included | OS disk billed separately (Standard SSD E4, 32 GB, about $2.40) | 20 GB SSD, included |
| Public IPv4 | Included | Standard static public IP billed separately (about $3.65) | Included |
| Data transfer | 2 TB a month included | First 100 GB a month free, then billed | 1 TB included |
| Monthly total | **$7.00** | **about $12 to $13** (about $9 to $10 with a 1-year reservation of the VM) | $5.00 |
| Fit | Inside a $5 to $10 budget, one fixed price | Over budget unless the VM is reserved; fits if everything else is on Azure | Too tight: 215 MB of containers plus the OS, Docker and an image pull in 512 MB needs swap and still risks the OOM killer |

The recommendation is Lightsail Micro in an EU region (Frankfurt `eu-central-1` or
Ireland `eu-west-1`). The waitlist holds personal data, and the privacy notice is
written for EU visitors. Lightsail has one fixed price that includes the address, disk
and transfer, so the bill cannot grow the way the earlier EC2 lab VM did. Its
snapshots (about $0.05 per GB a month) are the only extra. Set an AWS Budgets alert
at $10 either way.

### Infrastructure to create

Whoever provisions the VM (Terraform or by hand) creates this. No part of this
repository creates cloud resources.

| Item | Lightsail | Azure |
|---|---|---|
| Instance | `aws_lightsail_instance`, blueprint `ubuntu_24_04`, bundle `micro_3_0` (check `aws lightsail get-bundles` for the current id), EU region | `azurerm_linux_virtual_machine`, `Standard_B2ats_v2`, Ubuntu 24.04 LTS (`Canonical` / `ubuntu-24_04-lts` / `server`), Standard SSD 32 GB OS disk, EU region |
| Public address | `aws_lightsail_static_ip` and its attachment (free while attached) | `azurerm_public_ip`, Standard SKU, static |
| Firewall | `aws_lightsail_instance_public_ports`: TCP 80 and 443 and UDP 443 from anywhere; TCP 22 from the admin's address only | Network security group with the same rules |
| SSH | Key pair only, no password login | `disable_password_authentication = true`, `admin_ssh_key` |
| First boot | `user_data`: the cloud-init below | `custom_data`: the cloud-init below |
| Backups | Automatic daily snapshots (`add_on` `AutoSnapshot`), or none and rely on the nightly dump | Azure Backup for the VM, or none and rely on the nightly dump |
| Budget alert | AWS Budgets, monthly, $10, email `hello@cloudtrain.app` | `azurerm_consumption_budget_resource_group`, same |
| DNS | `A cloudtrain.app`, `A www.cloudtrain.app` (or `CNAME www` to the apex), both to the static IP; `AAAA` too if the instance has IPv6 | same |

Mail records for the same zone are in [email.md](email.md). `.app` is on the HSTS
preload list, so browsers reach the site over HTTPS only. Ports 80 and 443 must be
open before the first start, or Caddy cannot get its certificates.

### First boot (cloud-init)

```yaml
#cloud-config
package_update: true
package_upgrade: true
packages: [docker.io, docker-compose-v2, unattended-upgrades]
swap:
  filename: /swapfile
  size: 1G
runcmd:
  - systemctl enable --now docker
  - mkdir -p /opt/cloudtrain-site
  - printf '15 3 * * * root /opt/cloudtrain-site/backup.sh >> /var/log/cloudtrain-site-backup.log 2>&1\n' > /etc/cron.d/cloudtrain-site-backup
```

Ubuntu turns on unattended security updates by default; the package above makes sure
of it. The 1 GB swap file covers image pulls and upgrades.

## Install

Run these steps from a checkout of the repository, on your machine, unless a step says
"on the VM". `VM` stands for `ubuntu@<the static IP>`.

1. **Configure the site.** Check the contact addresses and the copy in
   `content/site.yaml` (see "Placeholders to fill in" in
   [deploy-website.md](deploy-website.md#coming-soon-step-by-step)), then run
   `node tools/lab-verify/bin/lab-verify.mjs --strict`.
2. **Build the static site.** `CT_API_BASE` stays empty: the form posts to the same
   origin, and Caddy forwards it, so there is no CORS to set up.

   ```sh
   pnpm install --frozen-lockfile
   CT_API_BASE= CT_SITE_URL=https://cloudtrain.app CT_APP_URL= \
     pnpm --filter web build:site
   ```

3. **Copy the files to the VM.**

   ```sh
   rsync -a deploy/site-vm/ VM:/tmp/cloudtrain-site/
   rsync -a --delete apps/web/dist-site/ VM:/tmp/cloudtrain-site/site/
   scp content/site.yaml VM:/tmp/cloudtrain-site/site.yaml
   ssh VM 'sudo rsync -a /tmp/cloudtrain-site/ /opt/cloudtrain-site/ && rm -rf /tmp/cloudtrain-site'
   ```

4. **Write the settings on the VM.** Each secret is a fresh random value.

   ```sh
   cd /opt/cloudtrain-site
   sudo cp .env.example .env && sudo chmod 600 .env
   for k in POSTGRES_PASSWORD CT_OWNER_PASSWORD CT_APP_PASSWORD CT_SESSION_SECRET; do
     sudo sed -i "s|^$k=.*|$k=$(openssl rand -hex 24)|" .env
   done
   sudo grep -E '^(SITE_HOST|ACME_EMAIL|GATEWAY_IMAGE)=' .env   # check these three
   ```

5. **Start the stack, on the VM.** Check DNS first: Caddy requests the certificates on
   the first start, so `dig +short cloudtrain.app` must already show the static IP.

   ```sh
   cd /opt/cloudtrain-site
   sudo docker compose up -d
   sudo docker compose ps -a     # migrate: Exited (0); the others: running
   sudo docker compose logs caddy | grep -i certificate
   ```

6. **Check the site from your machine.**

   ```sh
   curl -sI https://cloudtrain.app/ | grep -iE '^HTTP|strict-transport|content-security'
   curl -s -o /dev/null -w '%{http_code}\n' https://cloudtrain.app/api/public/site      # 200
   curl -s -o /dev/null -w '%{http_code}\n' https://cloudtrain.app/api/auth/login       # 404
   curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' https://www.cloudtrain.app/ # 301
   ```

   Then join the waitlist once in a browser and confirm the entry exists (see Operations).

## Operations

All commands run on the VM, in `/opt/cloudtrain-site`, with `sudo`.

| Task | Command |
|---|---|
| Status, logs | `docker compose ps -a`, `docker compose logs -f --tail 100 gateway` |
| Export the waitlist | `docker compose exec -T postgres psql -U postgres -d cloudtrain -c "\copy (select created_at, email, organisation, role, interest from waitlist_entries order by created_at) to stdout with csv header" > waitlist.csv` |
| Delete one entry (a deletion request) | `docker compose exec -T postgres psql -U postgres -d cloudtrain -c "delete from waitlist_entries where email = 'someone@example.com'"`. Old dumps keep the entry until they age out (14 days). |
| Update the site copy or the build | Run install steps 1 to 3 again, then `docker compose restart gateway`. The gateway reads `site.yaml` only at start; Caddy serves new files in `site/` at once |
| Update the gateway | Set `GATEWAY_IMAGE` in `.env` to the new digest (`docker buildx imagetools inspect ghcr.io/thecorporatetractor/cloudtrain/gateway:main`), then `docker compose up -d`. The `migrate` service applies new migrations first |
| Backup | `backup.sh` runs nightly from cron (cloud-init above): a `pg_dump` into `/var/backups/cloudtrain-site`, kept for 14 days. Run it by hand before an upgrade |
| Restore | `docker compose exec -T postgres pg_restore -U postgres -d cloudtrain --clean --if-exists < /var/backups/cloudtrain-site/<file>.dump` |
| Rotate a database password | Change it in Postgres (`ALTER ROLE cloudtrain_app PASSWORD '...'`) and in `.env`, then `docker compose up -d`. The init script reads `.env` only on an empty volume |

Keep the dumps on the VM, or copy them off only to storage that the privacy notice
covers. They contain the waitlist's email addresses.

## Going live later

When the platform runs on a cluster at `app.cloudtrain.app`, rebuild the site with
`CT_APP_URL=https://app.cloudtrain.app`, `--launch live` and `--pricing`. Leave
`CT_API_BASE` empty only while this VM still serves the public API. If the platform's
gateway takes over the waitlist, set `CT_API_BASE` to it and add the site's origin to
that gateway's `CT_CORS_ORIGINS` (see [deploy-website.md](deploy-website.md#the-waitlist-backend)).
Move the waitlist table with `pg_dump --table waitlist_entries`.
