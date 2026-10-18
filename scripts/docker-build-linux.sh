#!/bin/sh
# Construit l'AppImage et le .deb dans un conteneur Linux (fonctionne depuis Windows).
# Usage : docker run -v ./:/src:ro -v ./dist:/out electronuserland/builder:20 sh /src/scripts/docker-build-linux.sh
set -e
mkdir -p /build
cp -r /src/src /src/assets /src/package.json /build/
cd /build
npm install --no-audit --no-fund --silent
npx electron-builder --linux AppImage deb --publish never
cp dist/*.AppImage dist/*.deb /out/
ls -la /out
