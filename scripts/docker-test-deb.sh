#!/bin/sh
# Installe le .deb dans un Debian vierge, lance l'app (thème sombre) sous Xvfb et capture quelques pages.
# Usage : docker run -v ./:/src:ro -v <sortie>:/out node:22-bookworm sh /src/scripts/docker-test-deb.sh
set -e
apt-get update -qq >/dev/null
DEBIAN_FRONTEND=noninteractive apt-get install -y -qq /src/dist/fastboost_*_amd64.deb xvfb xauth fonts-cantarell adwaita-icon-theme iproute2 xterm galculator mousepad >/dev/null 2>&1
echo "installé : $(dpkg -s fastboost | grep Version)"
ls /usr/share/applications | grep -i fastboost
id alix >/dev/null 2>&1 || useradd -m alix
mkdir -p "/home/alix/.config/FastBoost" /home/alix/Downloads
echo '{"theme":"dark"}' > "/home/alix/.config/FastBoost/preferences.json"
chown -R alix /home/alix
su alix -c '(XDG_CURRENT_DESKTOP=GNOME xvfb-run -a -s "-screen 0 1280x800x24" fastboost --no-sandbox --disable-gpu --remote-debugging-port=9334 >/tmp/app.log 2>&1 &) && \
  node /src/scripts/cdp-shots.js /out 9334 home:4000 processes:3000 uninstall:3000 toolbox:1500 settings:2000 || (echo LOG:; cat /tmp/app.log)'
echo "----- 2e instance : fastboost --mini (chemin du raccourci clavier)"
su alix -c 'xvfb-run -a fastboost --mini --no-sandbox --disable-gpu >/tmp/second.log 2>&1; echo "2e instance terminée (code $?)"'
su alix -c 'node /src/scripts/cdp-mini.js /out 9334 -deb || (echo LOG:; cat /tmp/app.log)'
