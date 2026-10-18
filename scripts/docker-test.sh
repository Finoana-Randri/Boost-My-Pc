#!/bin/sh
# Prépare un conteneur Linux (Debian, Fedora ou Arch) puis lance les tests des services Linux.
# Usage : docker run -v ./src:/app/src:ro -v ./scripts:/app/scripts:ro <image> sh /app/scripts/docker-test.sh
set -e
if command -v apt-get >/dev/null; then
  apt-get update -qq >/dev/null && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq xterm iproute2 iputils-ping ufw >/dev/null 2>&1
elif command -v dnf >/dev/null; then
  dnf install -y -q nodejs xterm iproute iputils firewalld shadow-utils util-linux >/dev/null 2>&1
elif command -v pacman >/dev/null; then
  pacman -Sy --noconfirm -q nodejs xterm iproute2 iputils pacman-contrib >/dev/null 2>&1
fi
mkdir -p /etc/xdg/autostart
printf '[Desktop Entry]\nType=Application\nName=Demo\nName[fr]=Démo\nExec=/usr/bin/demo --bg\nIcon=xterm-color\n' > /etc/xdg/autostart/demo.desktop
id alix >/dev/null 2>&1 || useradd -m alix
mkdir -p /home/alix/Downloads
chown -R alix /home/alix
su alix -c "cd /app && LANG=fr_FR.UTF-8 node scripts/test-linux-services.js"
