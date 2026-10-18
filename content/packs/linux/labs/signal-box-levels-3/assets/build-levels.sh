#!/bin/bash
# Builds signal-box levels 11-15 for one learner. Usage: build-levels.sh KEY
set -eu
key=$1
tok() { printf 'sb-%s-%s' "$key" "$1" | sha256sum | cut -c1-24; }
H=/home/learner/signalbox
S=/usr/local/share/signalbox
V=/var/lib/cloudtrain
rm -rf "$H" "$S"; mkdir -p "$H" "$S"
w=$(mktemp -d)
pack() { (cd "$2" && tar -cf - .) | openssl enc -aes-256-cbc -pbkdf2 -salt -pass "pass:$(tok $(( $1 - 1 )))" -out "$S/level$1.pack"; }

# Accounts, hosts name and the two sshd ports.
for u in gate11 gate12; do
  id $u >/dev/null 2>&1 || useradd -m -s /bin/bash -p '*' $u
  chmod 0750 /home/$u; install -d -m 0700 -o $u -g $u /home/$u/.ssh
done
grep -q ' sb-gate$' /etc/hosts || echo '127.0.0.1 sb-gate' >> /etc/hosts
ssh-keygen -A >/dev/null; mkdir -p /run/sshd
cat > /etc/ssh/sshd_config_sb <<'EOT'
# Tallowmere signal box gate: keys only, two ports on the loopback.
Port 22
Port 2222
ListenAddress 127.0.0.1
HostKey /etc/ssh/ssh_host_ed25519_key
PidFile /run/sshd-sb.pid
PasswordAuthentication no
KbdInteractiveAuthentication no
PubkeyAuthentication yes
AllowUsers gate11 gate12
UsePAM yes
Subsystem sftp internal-sftp
Match User gate12
  ForceCommand internal-sftp
  AllowTcpForwarding no
EOT
if [ -f /run/sshd-sb.pid ] && kill -0 "$(cat /run/sshd-sb.pid)" 2>/dev/null; then kill "$(cat /run/sshd-sb.pid)"; sleep 1; fi
/usr/sbin/sshd -f /etc/ssh/sshd_config_sb

# Level 11: ssh with a key that has the wrong permissions.
d=$H/level11; mkdir -p "$d"
rm -f "$d/id_gate11"; ssh-keygen -q -t ed25519 -N '' -C gate11 -f "$d/id_gate11"; rm -f "$d/id_gate11.pub"
cp /dev/null /home/gate11/.ssh/authorized_keys
ssh-keygen -y -f "$d/id_gate11" > /home/gate11/.ssh/authorized_keys
chown gate11: /home/gate11/.ssh/authorized_keys; chmod 0600 /home/gate11/.ssh/authorized_keys
chmod 0644 "$d/id_gate11"
printf 'The password for level 12 is %s\n' "$(tok 11)" > /home/gate11/password-12
chown gate11: /home/gate11/password-12; chmod 0640 /home/gate11/password-12
printf 'Signal box, level 11.\nThe account gate11 on the host sb-gate (ssh, port 22) is reachable only with the\nkey id_gate11 in this directory. The password for level 12 is in the file\npassword-12 in its home directory.\nUnlock: sb-unlock 12 PASSWORD\n' > "$d/README"

# Level 12: a key for sftp only, on another port.
d=$w/12; mkdir -p "$d"
ssh-keygen -q -t ed25519 -N '' -C gate12 -f "$d/id_gate12"; chmod 0644 "$d/id_gate12"
cp "$d/id_gate12.pub" /home/gate12/.ssh/authorized_keys; rm -f "$d/id_gate12.pub"
chown gate12: /home/gate12/.ssh/authorized_keys; chmod 0600 /home/gate12/.ssh/authorized_keys
printf 'The password for level 13 is %s\n' "$(tok 12)" > /home/gate12/relay.txt
chown gate12: /home/gate12/relay.txt; chmod 0640 /home/gate12/relay.txt
printf 'Signal box, level 12.\nThe account gate12 on sb-gate has no shell: it only offers file transfer, and the\nserver for it listens on port 2222, not 22. Use the key id_gate12. The file\nrelay.txt in its home directory holds the password for level 13.\nUnlock: sb-unlock 13 PASSWORD\n' > "$d/README"
pack 12 "$d"

# Level 13: a plain-text service.
d=$w/13; mkdir -p "$d"
printf 'Signal box, level 13.\nA relay on 127.0.0.1 port 30013 hands out the password for level 14 to anyone\nwho sends it the password they used to unlock THIS level. It speaks plain text:\ntalk to it with nc.\nUnlock: sb-unlock 14 PASSWORD\n' > "$d/README"
printf 'gate-ref: %s\n' "$(tok 1013)" >> "$d/README"
pack 13 "$d"

# Level 14: the same relay behind TLS.
d=$w/14; mkdir -p "$d"
printf 'Signal box, level 14.\nThe next relay is on 127.0.0.1 port 30014 and speaks TLS with a self-signed\ncertificate. Same deal: send it the password you used to unlock this level.\nUnlock: sb-unlock 15 PASSWORD\n' > "$d/README"
pack 14 "$d"

# Level 15: a scheduled job delivers the final token.
d=$w/15; mkdir -p "$d"
printf 'Signal box, level 15 (the last of this set).\nThe final token is delivered by the dispatcher, a job cron runs every minute.\nWork out from its cron entry and script how to ask for it, wait for the next\nrun and write the token (just the token) to ~/answers/signal-box-3.txt\nThe dispatcher only answers a request that proves you got here: the request file\nmust hold the password you used to unlock this level.\n' > "$d/README"
printf 'gate-ref: %s\n' "$(tok 1015)" >> "$d/README"
pack 15 "$d"
tok 15 > $V/sb15.token; tok 14 > $V/sb14.token; chmod 0600 $V/sb15.token $V/sb14.token
cat > /usr/local/sbin/sb-dispatch <<'EOT'
#!/bin/sh
# Signal box dispatcher. Delivers the final-level report to every user who has left a
# file named `request` in ~/signalbox/level15 that holds the level 15 unlock password,
# then removes the request.
PATH=/usr/sbin:/usr/bin:/sbin:/bin   # cron's PATH lacks /usr/sbin, where runuser lives
for d in /home/*/signalbox/level15; do
  [ -L "$d" ] && continue
  [ -d "$d" ] && [ -e "$d/request" ] || continue
  who=$(stat -c %U "$d")
  home=$(dirname "$(dirname "$d")")
  # the signalbox directory must be a real directory owned by the home owner
  [ -L "$(dirname "$d")" ] && continue
  [ "$(stat -c %U "$home")" = "$who" ] && [ "$(stat -c %U "$(dirname "$d")")" = "$who" ] || continue
  # never follow links: all reads and writes happen as the owning user
  if [ -L "$d/request" ] || [ -L "$d/reply.txt" ]; then runuser -u "$who" -- rm -f "$d/request"; continue; fi
  got=$(runuser -u "$who" -- cat "$d/request" 2>/dev/null | tr -d '[:space:]')
  if [ "$got" != "$(cat /var/lib/cloudtrain/sb14.token)" ]; then
    printf 'Wrong request: it must hold the password you used to unlock level 15.\n' | runuser -u "$who" -- sh -c 'cat > "$1"' _ "$d/reply.txt"
    runuser -u "$who" -- rm -f "$d/request"; continue
  fi
  printf 'The final token is %s\n' "$(cat /var/lib/cloudtrain/sb15.token)" | runuser -u "$who" -- sh -c 'cat > "$1"' _ "$d/reply.txt"
  runuser -u "$who" -- rm -f "$d/request"
done
EOT
chmod 0755 /usr/local/sbin/sb-dispatch
printf '# Signal box dispatcher: see /usr/local/sbin/sb-dispatch\n* * * * * root /usr/local/sbin/sb-dispatch\n' > /etc/cron.d/sb-dispatch
chmod 0644 /etc/cron.d/sb-dispatch
pgrep -x cron >/dev/null || cron

# Relay services (tokens and the TLS key stay root-only).
python3 - "$key" > $V/sb-tokens.json <<'EOT'
import hashlib, json, sys
print(json.dumps({str(n): hashlib.sha256(f"sb-{sys.argv[1]}-{n}".encode()).hexdigest()[:24] for n in range(10, 16)}))
EOT
chmod 0600 $V/sb-tokens.json
[ -f $V/sb-relay.key ] || openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -nodes -days 30 -subj /CN=sb-gate -keyout $V/sb-relay.key -out $V/sb-relay.crt >/dev/null 2>&1
chmod 0600 $V/sb-relay.key
pkill -f '^python3 /usr/local/lib/signalbox/relay.py' || true
sleep 1
setsid nohup python3 /usr/local/lib/signalbox/relay.py >/dev/null 2>&1 </dev/null &
for i in $(seq 20); do (echo > /dev/tcp/127.0.0.1/30014) >/dev/null 2>&1 && break; sleep 0.5; done

chmod 0644 "$S"/*.pack
chown -R learner:learner "$H"
rm -rf "$w"
