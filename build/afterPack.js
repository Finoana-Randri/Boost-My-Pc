// Linux packages: the Electron binary becomes boost-my-pc.bin and this launcher takes its name.
//
// Chromium's SUID sandbox helper can't start from "/opt/Boost My Pc" (spaces in the path), so the
// user-namespace sandbox is requested. Where the system forbids it too (Ubuntu 24.04 without the
// AppArmor profile, an AppImage...), Chromium stops at once: the launcher then starts it again
// without the sandbox.
const fs = require('fs');
const path = require('path');

const LAUNCHER = `#!/bin/sh
BIN="$(dirname "$(readlink -f "$0")")/boost-my-pc.bin"
START=$(date +%s)
"$BIN" --disable-setuid-sandbox "$@"
CODE=$?
if [ "$CODE" -ne 0 ] && [ $(( $(date +%s) - START )) -lt 8 ]; then
  exec "$BIN" --no-sandbox "$@"
fi
exit "$CODE"
`;

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'linux') return;
  const launcher = path.join(context.appOutDir, context.packager.executableName);
  const binary = `${launcher}.bin`;
  if (!fs.existsSync(launcher) || fs.existsSync(binary)) return;
  fs.renameSync(launcher, binary);
  fs.writeFileSync(launcher, LAUNCHER, { mode: 0o755 });
  fs.chmodSync(launcher, 0o755);
};
