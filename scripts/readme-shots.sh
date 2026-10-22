#!/bin/sh
# README screenshots (readme-01 … readme-13) and Smart Care run, on the app started by docker-v2.sh.
# Run as the test user from the app folder: sh scripts/readme-shots.sh <port> <folder>
PORT=$1
OUT=$2
node scripts/cdp-steps.js "$PORT" "$OUT" \
  'eval:(smartResult=null,lensData=null,go("smart"))' sleep:1500 shot:readme-01 \
  'eval:document.querySelector("#scan").click()' sleep:1500 shot:sc-1-analyse wait:.sc-btn.ready sleep:2000 shot:readme-02 \
  'eval:go("cleanup")' sleep:800 'eval:document.querySelector("#scan").click()' 'wait:#do-clean' sleep:1500 shot:readme-03 \
  'eval:go("protection")' sleep:1500 shot:readme-04 \
  'eval:go("protection/privacy")' 'wait:#pv .pick-card' sleep:1200 shot:readme-05 \
  'eval:go("performance")' sleep:800 'eval:document.querySelector("#scan")?.click()' wait:.ov-grid sleep:1500 shot:readme-06 \
  'eval:go("applications/leftovers")' 'wait:#lo, .empty' sleep:1200 shot:readme-07 \
  'eval:go("clutter/similar")' sleep:800 'eval:document.querySelector("#scan")?.click()' 'wait:#sim, .empty' sleep:1500 shot:readme-08 \
  'eval:go("lens")' sleep:800 'eval:document.querySelector("[data-root]").click()' wait:.bubble sleep:1800 shot:readme-09 \
  'eval:document.querySelector(".bubble.dir").click()' sleep:1800 shot:carte-2 \
  'eval:go("cloud")' sleep:1500 'eval:document.querySelector("[data-cloud]")?.click()' 'wait:#cl-lists, .empty' sleep:1200 shot:readme-10 \
  'eval:go("shredder")' sleep:1500 shot:readme-11 \
  'eval:go("tools")' sleep:2500 shot:readme-12 \
  'eval:go("settings")' sleep:2500 shot:readme-13 \
  'eval:(smartResult=null,go("smart"))' sleep:800 'eval:document.querySelector("#scan").click()' wait:.sc-btn.ready sleep:1500 \
  'eval:document.querySelector("#sc-btn").click()' sleep:300 shot:sc-3-execution wait:.sc-btn.finished sleep:1200 shot:sc-4-termine
