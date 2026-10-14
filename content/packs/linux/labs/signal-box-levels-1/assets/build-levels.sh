#!/bin/bash
# Builds signal-box levels 1-5 for one learner. Usage: build-levels.sh KEY
# Tokens are derived from KEY so the grader can recompute them.
set -eu
key=$1
tok() { printf 'sb-%s-%s' "$key" "$1" | sha256sum | cut -c1-24; }
H=/home/learner/signalbox
S=/usr/local/share/signalbox
rm -rf "$H" "$S" /srv/signalbox
mkdir -p "$H" "$S" /srv/signalbox
w=$(mktemp -d)
pack() { # pack LEVEL DIR: encrypt DIR with the previous level's token
  (cd "$2" && tar -cf - .) | openssl enc -aes-256-cbc -pbkdf2 -salt -pass "pass:$(tok $(( $1 - 1 )))" -out "$S/level$1.pack"
}
# Level 1: a hidden file.
mkdir -p "$H/level1"
cat > "$H/level1/README" <<T
Signal box, level 1.
The password for level 2 is in this directory, but ls alone will not show it.
Unlock the next level with:  sb-unlock 2 PASSWORD
T
echo "$(tok 1)" > "$H/level1/.lever-frame"
# Level 2: an awkward file name.
d=$w/2; mkdir -p "$d"
printf 'Signal box, level 2.\nThe password for level 3 is in the file called -\n(yes, a single dash) in this directory.\nUnlock: sb-unlock 3 PASSWORD\n' > "$d/README"
echo "$(tok 2)" > "$d/-"
echo "not this one" > "$d/dash"
pack 2 "$d"
# Level 3: one human-readable file among data files.
d=$w/3; mkdir -p "$d/inhere"
printf 'Signal box, level 3.\nThe password for level 4 is in the only human-readable (ASCII text) file in inhere/.\nUnlock: sb-unlock 4 PASSWORD\n' > "$d/README"
for i in 0 1 2 3 4 5 6 7 8 9; do head -c 64 /dev/urandom > "$d/inhere/-file0$i"; done
n=$(( 0x$(printf '%s' "$key" | sha256sum | cut -c1-2) % 10 ))
echo "$(tok 3)" > "$d/inhere/-file0$n"
pack 3 "$d"
# Level 4: a file of an exact size and mode among many.
d=$w/4; mkdir -p "$d/yard"
printf 'Signal box, level 4.\nThe password for level 5 is in a file somewhere under yard/ that is\n  - human-readable\n  - exactly 1033 bytes in size\n  - not executable\nUnlock: sb-unlock 5 PASSWORD\n' > "$d/README"
for i in $(seq 1 12); do
  mkdir -p "$d/yard/siding$i"
  for j in 1 2 3; do
    f="$d/yard/siding$i/.wagon$j"; { echo "wagon $i.$j"; head -c $(( 900 + i * 13 + j )) /dev/zero | tr '\0' 'x'; } > "$f"; chmod 0644 "$f"
  done
done
f="$d/yard/siding7/.wagon2"; { echo "$(tok 4)"; head -c $(( 1033 - 25 )) /dev/zero | tr '\0' ' '; } > "$f"; chmod 0644 "$f"
g="$d/yard/siding3/.wagon1"; { echo "decoy-executable"; head -c $(( 1033 - 17 )) /dev/zero | tr '\0' ' '; } > "$g"; chmod 0755 "$g"
test "$(stat -c %s "$f")" = 1033 && test "$(stat -c %s "$g")" = 1033
pack 4 "$d"
# Level 5: a file anywhere under /srv/signalbox owned by a given user and group.
d=$w/5; mkdir -p "$d"
printf 'Signal box, level 5 (the last of this set).\nThe final token is stored somewhere under /srv/signalbox in a file that is\n  - owned by user signal5\n  - owned by group signalbox\n  - 25 bytes in size\nWrite the token to ~/answers/signal-box-1.txt\n' > "$d/README"
pack 5 "$d"
for u in signal4 signal5 signal6; do id $u >/dev/null 2>&1 || useradd -M -s /usr/sbin/nologin $u; done
getent group signalbox >/dev/null || groupadd signalbox
for i in $(seq 1 15); do
  mkdir -p /srv/signalbox/box$i
  for u in signal4 signal5 signal6; do
    f=/srv/signalbox/box$i/relay-$u; printf '%024d\n' $i > "$f"; chown $u:$u "$f"; chmod 0644 "$f"
  done
done
f=/srv/signalbox/box11/.relay-cfg; echo "$(tok 5)" > "$f"; chown signal5:signalbox "$f"; chmod 0644 "$f"
f=/srv/signalbox/box4/relay-cfg; echo "$(tok 5 | rev)" > "$f"; chown signal5:signal5 "$f"; chmod 0644 "$f"
chmod -R a+rX /srv/signalbox
chmod 0644 "$S"/*.pack
chown -R learner:learner "$H"
rm -rf "$w"
