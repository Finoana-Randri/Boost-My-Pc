#!/bin/sh
# Check Boost My Pc v2 on Linux in Debian with Xvfb: v2 services and UI flows with test data.
# Run: docker run -v ./:/src:ro -v <output>:/out node:22-bookworm sh /src/scripts/docker-v2.sh [dark|light]
set -e
THEME=${1:-dark}
apt-get -o Acquire::Check-Valid-Until=false -o Acquire::Check-Date=false update -qq >/dev/null
DEBIAN_FRONTEND=noninteractive apt-get install -y -qq --no-install-recommends \
  xvfb xauth libnss3 libgtk-3-0 libgbm1 libasound2 libxss1 libxtst6 libatk-bridge2.0-0 libdrm2 \
  fonts-cantarell adwaita-icon-theme iproute2 iputils-ping ufw cron xterm galculator >/dev/null 2>&1
id alix >/dev/null 2>&1 || useradd -m alix
H=/home/alix
mkdir -p $H/app "$H/.config/FastBoost" $H/Downloads $H/Pictures/vacances $H/Dropbox/projets $H/.config/autostart $H/.config/vieille-appli-supprimee $H/.cache/thumbnails/large
cp -r /src/src /src/assets /src/package.json /src/scripts $H/app/
echo "{\"theme\":\"$THEME\"}" > "$H/.config/FastBoost/preferences.json"
# Images: identical and near-identical copies (including a renamed copy) for Similar Images.
for f in /src/docs/screenshots/*.png; do cp "$f" $H/Pictures/; cp "$f" "$H/Pictures/vacances/copie-$(basename "$f")"; done
# Cloud: a Dropbox folder with a large old file.
head -c 30000000 /dev/urandom > $H/Dropbox/projets/video-2024.mp4 && touch -d '2 years ago' $H/Dropbox/projets/video-2024.mp4
head -c 2000000 /dev/urandom > $H/Dropbox/projets/archive.zip && touch -d '18 months ago' $H/Dropbox/projets/archive.zip
# Leftovers: an old config folder from an unknown app.
head -c 300000 /dev/urandom > $H/.config/vieille-appli-supprimee/data.db
touch -d '200 days ago' $H/.config/vieille-appli-supprimee/data.db $H/.config/vieille-appli-supprimee
# Test threat signals: an autostart entry and executable in /tmp.
printf '#!/bin/sh\necho test\n' > /tmp/miner.sh && chmod +x /tmp/miner.sh && chown alix /tmp/miner.sh
printf '[Desktop Entry]\nType=Application\nName=Updater\nExec=/tmp/miner.sh --silent\n' > $H/.config/autostart/updater.desktop
# A large, old download.
head -c 60000000 /dev/urandom > $H/Downloads/ancien-installateur.iso && touch -d '1 year ago' $H/Downloads/ancien-installateur.iso
chown -R alix $H
echo "===== Services v2"
su alix -c 'cd /home/alix/app && node scripts/test-v2-services.js'
echo "===== Interface v2 ($THEME)"
# Use Electron from the built .deb to avoid another download,
# then replace the packaged app with the current source.
DEB=$(ls /src/dist/Boost-My-Pc-*.deb | tail -1)
DEBIAN_FRONTEND=noninteractive apt-get -o Acquire::Check-Valid-Until=false -o Acquire::Check-Date=false install -y -qq "$DEB" >/dev/null 2>&1
RES=$(dirname "$(readlink -f /usr/bin/boost-my-pc)")/resources
rm -f "$RES/app.asar" && mkdir -p "$RES/app" && cp -r /src/src /src/assets /src/package.json "$RES/app/"
su alix -c "cd /home/alix/app && (XDG_CURRENT_DESKTOP=GNOME xvfb-run -a -s '-screen 0 1280x800x24' boost-my-pc --no-sandbox --disable-gpu --remote-debugging-port=9350 >/tmp/electron.log 2>&1 &) && \
  node scripts/cdp-shots.js /out 9350 smart:2500 cleanup:1500 protection:1500 performance:1500 applications:2500 lens:1500 shredder:1200 tools:2500 settings:2000 && \
  node scripts/cdp-flows.js /out 9350 smart cleanup threats privacy permissions status maintenance startup leftovers updates lens similar large downloads cloud shredder || cat /tmp/electron.log"
