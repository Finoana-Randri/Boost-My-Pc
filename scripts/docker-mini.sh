#!/bin/sh
# Check the Linux mini panel in a Debian container with Xvfb, in dark and light themes.
# Run: docker run -v ./:/src:ro -v <output>:/out node:22-bookworm sh /src/scripts/docker-mini.sh
set -e
apt-get update -qq >/dev/null
DEBIAN_FRONTEND=noninteractive apt-get install -y -qq --no-install-recommends \
  xvfb xauth libnss3 libgtk-3-0 libgbm1 libasound2 libxss1 libxtst6 libatk-bridge2.0-0 libdrm2 \
  fonts-cantarell adwaita-icon-theme iproute2 iputils-ping ufw >/dev/null 2>&1
id alix >/dev/null 2>&1 || useradd -m alix
H=/home/alix
mkdir -p $H/app "$H/.config/FastBoost" $H/Downloads $H/.local/share/Trash/files $H/.local/share/Trash/info $H/.cache/thumbnails/large
cp -r /src/src /src/assets /src/package.json $H/app/
# Test data: trash, thumbnails, and an old temporary file.
head -c 60000000 /dev/urandom > $H/.local/share/Trash/files/vieux-film.mkv
printf '[Trash Info]\nPath=/home/alix/vieux-film.mkv\nDeletionDate=2026-10-01T10:00:00\n' > $H/.local/share/Trash/info/vieux-film.mkv.trashinfo
head -c 8000000 /dev/urandom > $H/.cache/thumbnails/large/a.png
head -c 3000000 /dev/urandom > /tmp/ancien.tmp && chown alix /tmp/ancien.tmp && touch -d '3 days ago' /tmp/ancien.tmp
chown -R alix $H
su alix -c 'cd /home/alix/app && npm install --silent --no-audit --no-fund electron@33.4.11 >/dev/null 2>&1'
run() {
  echo "{\"theme\":\"$1\"}" > "$H/.config/FastBoost/preferences.json"; chown alix "$H/.config/FastBoost/preferences.json"
  su alix -c "cd /home/alix/app && (XDG_CURRENT_DESKTOP=GNOME xvfb-run -a -s '-screen 0 1280x800x24' ./node_modules/.bin/electron . --mini --no-sandbox --disable-gpu --remote-debugging-port=$2 >/tmp/electron-$1.log 2>&1 &) && node /src/scripts/cdp-mini.js /out $2 -$1"
  pkill -f "remote-debugging-port=$2" || true
  sleep 2
}
run dark 9340
echo "----- état après le 1er passage (corbeille vidée ?)"
ls -la $H/.local/share/Trash/files || true
# Recreate the trash for the light-theme screenshot.
head -c 60000000 /dev/urandom > $H/.local/share/Trash/files/vieux-film.mkv && chown alix $H/.local/share/Trash/files/vieux-film.mkv
run light 9341
