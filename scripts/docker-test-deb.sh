#!/bin/sh
# Install the .deb in a clean Debian container, run the app under Xvfb, and capture a few pages.
# Run: docker run -v ./:/src:ro -v <output>:/out node:22-bookworm sh /src/scripts/docker-test-deb.sh
set -e
apt-get update -qq >/dev/null
DEBIAN_FRONTEND=noninteractive apt-get install -y -qq /src/dist/Boost-My-Pc-*.deb xvfb xauth fonts-cantarell adwaita-icon-theme iproute2 xterm galculator mousepad >/dev/null 2>&1
echo "installed: $(dpkg -s boost-my-pc | grep Version)"
ls /usr/share/applications | grep -i boost-my-pc
id alix >/dev/null 2>&1 || useradd -m alix
mkdir -p "/home/alix/.config/Boost My Pc" /home/alix/Downloads
echo '{"theme":"dark"}' > "/home/alix/.config/Boost My Pc/preferences.json"
chown -R alix /home/alix
su alix -c '(XDG_CURRENT_DESKTOP=GNOME xvfb-run -a -s "-screen 0 1280x800x24" boost-my-pc --no-sandbox --disable-gpu --remote-debugging-port=9334 >/tmp/app.log 2>&1 &) && \
  node /src/scripts/cdp-shots.js /out 9334 home:4000 processes:3000 uninstall:3000 toolbox:1500 settings:2000 || (echo LOG:; cat /tmp/app.log)'
echo "----- second instance: boost-my-pc --mini (keyboard shortcut path)"
su alix -c 'xvfb-run -a boost-my-pc --mini --no-sandbox --disable-gpu >/tmp/second.log 2>&1; echo "second instance exited (code $?)"'
su alix -c 'node /src/scripts/cdp-mini.js /out 9334 -deb || (echo LOG:; cat /tmp/app.log)'
