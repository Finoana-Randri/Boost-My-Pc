// Linux packages: the Electron program is renamed boost-my-pc.bin and a small launcher takes its
// place, to deal with Chromium's sandbox:
//  - the install folder has spaces ("/opt/Boost My Pc"), which Chromium's SUID helper can't start,
//    so the sandbox that uses user namespaces is requested;
//  - some systems forbid those too (Ubuntu 24.04 without the AppArmor profile, an AppImage on
//    other distributions...): the program then stops within a second. The launcher notices that
//    and starts it again without the sandbox, instead of leaving the user with a crash.
const fs = require('fs');
const path = require('path');

const LAUNCHER = `#!/bin/sh
# Boost My Pc launcher (see build/afterPack.js).
BIN="$(dirname "$(readlink -f "$0")")/boost-my-pc.bin"
START=$(date +%s)
"$BIN" --disable-setuid-sandbox "$@"
CODE=$?
# Stopped at once with an error: no usable sandbox here, start again without it.
if [ "$CODE" -ne 0 ] && [ $(( $(date +%s) - START )) -lt 8 ]; then
  exec "$BIN" --no-sandbox "$@"
fi
exit "$CODE"
`;

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'linux') return;
  const exe = path.join(context.appOutDir, context.packager.executableName);
  const real = `${exe}.bin`;
  if (!fs.existsSync(exe) || fs.existsSync(real)) return;
  fs.renameSync(exe, real);
  fs.writeFileSync(exe, LAUNCHER, { mode: 0o755 });
  fs.chmodSync(exe, 0o755);
};
