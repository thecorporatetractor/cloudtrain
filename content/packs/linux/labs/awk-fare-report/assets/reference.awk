# Reference implementation (grader only).
{
  ok = 0; zone = ""; fare = ""
  for (i = 1; i <= NF; i++) {
    if ($i == "status=OK") ok = 1
    else if ($i ~ /^zone=/) zone = substr($i, 6)
    else if ($i ~ /^fare=/) fare = substr($i, 6)
  }
  if (!ok) next
  j[zone]++; r[zone] += fare; tj++; tr += fare
}
END {
  printf "%-5s %8s %9s\n", "ZONE", "JOURNEYS", "REVENUE"
  cmd = "sort -n"
  for (z in j) printf "%-5s %8d %9.2f\n", z, j[z], r[z] | cmd
  close(cmd)
  printf "%-5s %8d %9.2f\n", "TOTAL", tj, tr
}
