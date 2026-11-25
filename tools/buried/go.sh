#!/bin/zsh
cd ~/Developer/.hound-release/film/buried
caffeinate -i -s -w $$ &
python3 guard.py 1 >> guard1.log 2>&1 & A=$!
/bin/sleep 45
python3 guard.py 2 >> guard2.log 2>&1 &
wait $A
