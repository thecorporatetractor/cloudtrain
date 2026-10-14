#!/bin/bash
# seed-repo.sh: create the bare repository /srv/git/timetable-tools.git with history.
set -eu
R=/srv/git/timetable-tools.git
rm -rf "$R"; w=$(mktemp -d)
git init -q -b main "$w"; cd "$w"
git config user.name "Mara Quill"; git config user.email "mara.quill@tallowmere.example"
mkdir -p bin tests
cat > bin/ttfmt <<'S'
#!/bin/bash
# ttfmt MINUTES: format minutes after midnight as HH:MM (24-hour clock).
m=${1:?usage: ttfmt MINUTES}
h=$(( m / 60 ))
printf '%d:%02d\n' "$h" $(( m % 60 ))
S
chmod +x bin/ttfmt
cat > tests/run.sh <<'S'
#!/bin/bash
# Runs the ttfmt tests; exits non-zero on the first failure.
cd "$(dirname "$0")/.."
fail=0
t() { got=$(bin/ttfmt "$1"); [ "$got" = "$2" ] && echo "ok   ttfmt $1 = $2" || { echo "FAIL ttfmt $1: got $got, want $2"; fail=1; }; }
t 0 00:00
t 65 01:05
t 600 10:00
t 1439 23:59
t 1440 00:00
t 1505 01:05
exit $fail
S
chmod +x tests/run.sh
printf '# timetable-tools\n\nSmall helpers for the Tallowmere Rail timetable office.\nRun tests/run.sh before pushing.\n' > README.md
git add -A; GIT_AUTHOR_DATE='2026-09-01T09:00:00' GIT_COMMITTER_DATE='2026-09-01T09:00:00' git commit -qm "Add ttfmt and its tests"
printf '\n## ttfmt\n\nttfmt MINUTES prints a 24-hour HH:MM time. Departures after midnight wrap around.\n' >> README.md
git commit -qam "Document ttfmt" --date='2026-09-03T10:00:00'
git clone -q --bare "$w" "$R"
rm -rf "$w"
chown -R git:git /srv/git
git -c safe.directory='*' -C "$R" rev-parse main > /var/lib/cloudtrain/baseline
