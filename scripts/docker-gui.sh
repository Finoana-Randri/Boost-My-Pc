#!/bin/sh
# Lance l'interface Linux dans un conteneur Debian (Xvfb) et capture chaque page.
# Usage : docker run -v ./:/src:ro -v <sortie>:/out node:22-bookworm sh /src/scripts/docker-gui.sh [dark]
set -e
apt-get update -qq >/dev/null
DEBIAN_FRONTEND=noninteractive apt-get install -y -qq --no-install-recommends \
  xvfb xauth libnss3 libgtk-3-0 libgbm1 libasound2 libxss1 libxtst6 libatk-bridge2.0-0 libdrm2 \
  fonts-cantarell adwaita-icon-theme dbus-x11 iproute2 iputils-ping xterm galculator mousepad >/dev/null 2>&1
id alix >/dev/null 2>&1 || useradd -m alix
mkdir -p /home/alix/app /home/alix/Downloads /home/alix/.config/FastBoost
cp -r /src/src /src/assets /src/package.json /home/alix/app/
[ "$1" = "dark" ] && echo '{"theme":"dark"}' > /home/alix/.config/FastBoost/preferences.json
head -c 3000000 /dev/urandom > /home/alix/Downloads/ubuntu-24.04.iso
head -c 400000 /dev/urandom > /home/alix/Downloads/facture.pdf
chown -R alix /home/alix
su alix -c 'cd /home/alix/app && npm install --silent --no-audit --no-fund electron@33.4.11 >/dev/null 2>&1 && \
  (XDG_CURRENT_DESKTOP=GNOME xvfb-run -s "-screen 0 1280x800x24" ./node_modules/.bin/electron . --no-sandbox --disable-gpu --remote-debugging-port=9333 >/tmp/electron.log 2>&1 &) && \
  node /src/scripts/cdp-shots.js /out 9333 home:4000 health:3000 storage:2000 apps:1000 processes:3000 startup:2000 uninstall:3000 protection:3000 updates:6000 network:6000 toolbox:1000 settings:2000 downloads:1500'
