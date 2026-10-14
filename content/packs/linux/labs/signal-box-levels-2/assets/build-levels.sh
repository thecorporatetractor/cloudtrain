#!/bin/bash
# Builds signal-box levels 6-10 for one learner. Usage: build-levels.sh KEY
set -eu
key=$1
tok() { printf 'sb-%s-%s' "$key" "$1" | sha256sum | cut -c1-24; }
H=/home/learner/signalbox
S=/usr/local/share/signalbox
rm -rf "$H" "$S"; mkdir -p "$H" "$S"
w=$(mktemp -d)
pack() { (cd "$2" && tar -cf - .) | openssl enc -aes-256-cbc -pbkdf2 -salt -pass "pass:$(tok $(( $1 - 1 )))" -out "$S/level$1.pack"; }
words="ballast bogie buffer cant catenary coupler crossover deadman fishplate flange gauge interlock junction lever plinth points semaphore sleeper switch tablet token wagon"
# Level 6: the word next to the password.
d=$H/level6; mkdir -p "$d"
printf 'Signal box, level 6.\nThe password for level 7 is in data.txt next to the word "semaphore".\nUnlock: sb-unlock 7 PASSWORD\n' > "$d/README"
awk -v key="$key" -v words="$words" 'BEGIN {
  srand(key); split(words, w, " ")
  for (n = 1; n <= 4000; n++) {
    wd = w[n % 22 + 1]; if (wd == "semaphore") wd = "semaphores"
    h = ""; for (k = 0; k < 6; k++) h = h sprintf("%04x", int(rand() * 65536))
    printf "%s\t%s\n", wd, h
  }
}' > "$d/data.txt"
sed -i "1737s/.*/semaphore\t$(tok 6)/" "$d/data.txt"
# Level 7: the only line that appears exactly once.
d=$w/7; mkdir -p "$d"
printf 'Signal box, level 7.\nThe password for level 8 is the only line in data.txt that occurs exactly once.\nUnlock: sb-unlock 8 PASSWORD\n' > "$d/README"
awk -v key="$key" -v t="$(tok 7)" 'BEGIN {
  srand(key + 7)
  for (n = 1; n <= 300; n++) {
    h = ""; for (k = 0; k < 6; k++) h = h sprintf("%04x", int(rand() * 65536))
    print h; print h; if (n % 3 == 0) print h
  }
  print t
}' | shuf --random-source=<(yes "$key") > "$d/data.txt"
pack 7 "$d"
# Level 8: base64.
d=$w/8; mkdir -p "$d"
printf 'Signal box, level 8.\nThe password for level 9 is in data.txt, which is base64-encoded.\nUnlock: sb-unlock 9 PASSWORD\n' > "$d/README"
printf 'The password is %s\n' "$(tok 8)" | base64 > "$d/data.txt"
pack 8 "$d"
# Level 9: compressed layers.
d=$w/9; mkdir -p "$d"
printf 'Signal box, level 9.\nThe password for level 10 is in layers.bin, compressed several times\nwith different tools. file(1) tells you which one comes next.\nUnlock: sb-unlock 10 PASSWORD\n' > "$d/README"
l=$(mktemp -d)
printf 'The password is %s\n' "$(tok 9)" > "$l/inner.txt"
gzip -9 -c "$l/inner.txt" > "$l/stage1"
bzip2 -c "$l/stage1" > "$l/stage2"
tar -C "$l" -cf "$l/stage3" stage2
xz -c "$l/stage3" > "$d/layers.bin"
rm -rf "$l"
pack 9 "$d"
# Level 10: ROT13.
d=$w/10; mkdir -p "$d"
printf 'Signal box, level 10 (the last of this set).\nThe final token is in data.txt, but every letter was rotated by 13 places.\nWrite the token to ~/answers/signal-box-2.txt\n' > "$d/README"
printf 'The final token is %s\n' "$(tok 10)" | tr 'A-Za-z' 'N-ZA-Mn-za-m' > "$d/data.txt"
pack 10 "$d"
chmod 0644 "$S"/*.pack
chown -R learner:learner "$H"
rm -rf "$w"
