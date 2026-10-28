#!/bin/bash
# What a user sees on Ubuntu 24.04: install the .deb (with its dependencies), start as a normal user,
# icons, notifications through a real daemon, rounded window, window buttons and edges, then the AppImage.
# Run: docker run --rm -v <dist>:/pkgs:ro -v ./:/src:ro -v <node folder>:/node:ro -v <out>:/out ubuntu:24.04 \
#        bash /src/scripts/docker-ubuntu.sh [deb file]
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq >/dev/null 2>&1
apt-get install -y -qq --no-install-recommends curl xvfb xauth openbox xcompmgr xdotool imagemagick x11-utils x11-xserver-utils dbus dbus-x11 dunst libnotify-bin libglib2.0-bin ca-certificates >/dev/null 2>&1
DEB=${1:-$(ls /pkgs/*.deb | head -1)}
ln -sf /node/node /usr/local/bin/node
echo "===== Installation du .deb ($(basename "$DEB"))"
apt-get install -y -qq "$DEB" >/tmp/apt.log 2>&1 || { echo "ECHEC apt"; tail -5 /tmp/apt.log; }
APP="/opt/Boost My Pc"
echo "chrome-sandbox (non utilise) : $(stat -c '%a %U' "$APP/chrome-sandbox")"
echo "lanceur        : $(head -c 2 "$APP/boost-my-pc") $(readlink -f /usr/bin/boost-my-pc)"
echo "icones         : $(ls /usr/share/icons/hicolor | tr '\n' ' ')"
echo "entree menu    : $(grep -E '^(Name|Exec|Icon)=' /usr/share/applications/boost-my-pc.desktop | tr '\n' ' ')"

id tester >/dev/null 2>&1 || useradd -m tester
mkdir -p /home/tester/.config/"Boost My Pc"
echo '{"welcomed":true,"effects":"on","theme":"dark","notifications":true,"sounds":false}' > /home/tester/.config/"Boost My Pc"/preferences.json
chown -R tester /home/tester
Xvfb :99 -screen 0 1400x900x24 +extension Composite >/dev/null 2>&1 &
sleep 2
cp /src/scripts/cdp-steps.js /tmp/ && chmod 644 /tmp/cdp-steps.js

cat > /tmp/session.sh <<'EOS'
export DISPLAY=:99
xsetroot -solid '#e8590c'
openbox >/dev/null 2>&1 &
xcompmgr >/dev/null 2>&1 &
dunst >/tmp/dunst.log 2>&1 &
sleep 2
cdp() { node /tmp/cdp-steps.js 9350 /out "$@" 2>&1 | grep -E 'eval|shot|errors'; }
echo "===== Demarrage ($1)"
$1 --remote-debugging-port=9350 >/tmp/app.log 2>&1 &
for i in $(seq 1 90); do curl -s -m 2 http://127.0.0.1:9350/json | grep -q index.html && break; sleep 1; done
if curl -s -m 2 http://127.0.0.1:9350/json | grep -q index.html; then echo "demarre : OUI"; else echo "demarre : NON"; head -5 /tmp/app.log; exit 0; fi
sleep 3
echo "== Fenetre"
cdp "eval:document.documentElement.className + ' | ' + document.querySelectorAll('[data-wc]').length + ' boutons | ' + document.querySelectorAll('.rz').length + ' bords'" "eval:go('applications/updates')" sleep:1500
WID=$(xdotool search --onlyvisible --name 'Boost My Pc' | tail -1)
echo "fenetre : $(xdotool getwindowgeometry $WID | tr '\n' ' ')"
sleep 1
import -window root /out/ubuntu-root.png
echo "== Maximiser (bouton)"
cdp "eval:document.querySelector('[data-wc=maximize]').click()" sleep:1500 "eval:document.documentElement.className"
echo "geometrie : $(xdotool getwindowgeometry $WID | tr '\n' ' ')"
cdp "eval:document.querySelector('[data-wc=maximize]').click()" sleep:1500 "eval:document.documentElement.className"
echo "== Redimensionner a la souris (coin bas-droit)"
read X Y < <(xdotool getwindowgeometry $WID | awk '/Position/{split($2,p,","); x=p[1]; y=p[2]} /Geometry/{split($2,g,"x"); print x+g[1]-3, y+g[2]-3}')
echo "avant : $(xdotool getwindowgeometry $WID | grep Geometry)"
xdotool mousemove $X $Y; sleep 0.4; xdotool mousedown 1; sleep 0.3
for d in 20 50 90 140 ; do xdotool mousemove $((X+d)) $((Y+d/2)); sleep 0.15; done
xdotool mouseup 1; sleep 0.5
echo "apres : $(xdotool getwindowgeometry $WID | grep Geometry)"
echo "== Notification"
cdp "eval:pcm.notify({title:'Boost My Pc',body:'Analyse terminee : 3 points a traiter'}).then(r=>'notify '+r,e=>'ERR '+e.message)" sleep:1500
echo "dunst affiche : $(dunstctl count displayed 2>&1) / en attente : $(dunstctl count waiting 2>&1) / historique : $(dunstctl count history 2>&1)"
import -window root /out/ubuntu-notif.png
echo "== Fermer (bouton)"
cdp "eval:document.querySelector('[data-wc=close]').click()" sleep:1500
echo "processus apres fermeture : $(pgrep -fc 'boost-my-pc.bin' || true)"
EOS
chmod 755 /tmp/session.sh
su tester -c "dbus-run-session -- bash /tmp/session.sh boost-my-pc"
pkill -f boost-my-pc.bin; sleep 2

echo; echo "===== AppImage"
AI=$(ls /pkgs/*.AppImage 2>/dev/null | head -1)
if [ -n "$AI" ]; then
  cp "$AI" /home/tester/Boost.AppImage; chown tester /home/tester/Boost.AppImage; chmod +x /home/tester/Boost.AppImage
  cat > /tmp/ai.sh <<'EOS'
export DISPLAY=:99 APPIMAGE_EXTRACT_AND_RUN=1
/home/tester/Boost.AppImage --remote-debugging-port=9350 >/tmp/ai.log 2>&1 &
for i in $(seq 1 90); do curl -s -m 2 http://127.0.0.1:9350/json | grep -q index.html && break; sleep 1; done
curl -s -m 2 http://127.0.0.1:9350/json | grep -q index.html && echo "AppImage demarre : OUI" || { echo "AppImage demarre : NON"; grep -viE "bus.cc|dbus|appimage_extracted" /tmp/ai.log | head -6; }
sleep 8
D=~/.local/share/applications/boost-my-pc.desktop
echo "entree menu : $(grep -E '^(Exec|Icon)=' $D 2>/dev/null | tr '\n' ' ')"
echo "icones : $(ls ~/.local/share/icons/hicolor 2>/dev/null | tr '\n' ' ')"
EOS
  su tester -c "dbus-run-session -- bash /tmp/ai.sh"
fi
echo "===== fin"
