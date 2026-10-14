#!/bin/bash
# rotate-roster.sh: archive this week's crew roster and rotate the crews.
# Usage: rotate-roster.sh DIR [SHIFT]
DIR=$1
SHIFT=${2:-1}
WEEK=$(date +%G-W%V)
mkdir $DIR/archive
cp $DIR/current.csv $DIR/archive/roster-$WEEK.csv
tr-crewshift $SHIFT < $DIR/archive/roster-$WEEK.csv > $DIR/current.csv
echo "rotated $DIR for $WEEK"
