#!/bin/sh
# Build the AppImage and .deb in a Linux container, including from Windows.
# Run: docker run -v ./:/src:ro -v ./dist:/out electronuserland/builder:20 sh /src/scripts/docker-build-linux.sh
set -e
mkdir -p /build
cp -r /src/src /src/assets /src/package.json /src/package-lock.json /build/
cd /build
npm ci --no-audit --no-fund --silent
npx electron-builder --linux AppImage deb --publish never
cp dist/*.AppImage dist/*.deb /out/
ls -la /out
