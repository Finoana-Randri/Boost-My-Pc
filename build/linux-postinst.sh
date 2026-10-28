#!/bin/bash
# Boost My Pc (.deb): runs after the files are installed.
APP='/opt/Boost My Pc'

# Command in the PATH.
if type update-alternatives 2>/dev/null >&1; then
    if [ -L '/usr/bin/boost-my-pc' -a -e '/usr/bin/boost-my-pc' -a "`readlink '/usr/bin/boost-my-pc'`" != '/etc/alternatives/boost-my-pc' ]; then
        rm -f '/usr/bin/boost-my-pc'
    fi
    update-alternatives --install '/usr/bin/boost-my-pc' 'boost-my-pc' "$APP/boost-my-pc" 100 || ln -sf "$APP/boost-my-pc" '/usr/bin/boost-my-pc'
else
    ln -sf "$APP/boost-my-pc" '/usr/bin/boost-my-pc'
fi

# Chromium's SUID helper can't be started from a folder with spaces: not used (the launcher asks
# for the user-namespace sandbox).
chmod 0755 "$APP/chrome-sandbox" || true

# Ubuntu 24.04 and later forbid user namespaces to ordinary programs unless an AppArmor profile
# allows them: install the profile for this program (same method as Chrome or VS Code).
if [ -e /etc/apparmor.d/abi/4.0 ]; then
    cat > /etc/apparmor.d/boost-my-pc <<'EOF'
abi <abi/4.0>,
include <tunables/global>

profile boost-my-pc "/opt/Boost My Pc/boost-my-pc.bin" flags=(unconfined) {
  userns,

  # Site-specific additions and overrides.
  include if exists <local/boost-my-pc>
}
EOF
    if hash apparmor_parser 2>/dev/null; then
        apparmor_parser -r /etc/apparmor.d/boost-my-pc 2>/dev/null || true
    fi
fi

# Menus, file types and icons.
if hash update-mime-database 2>/dev/null; then
    update-mime-database /usr/share/mime || true
fi
if hash update-desktop-database 2>/dev/null; then
    update-desktop-database /usr/share/applications || true
fi
if hash gtk-update-icon-cache 2>/dev/null; then
    gtk-update-icon-cache -q -t -f /usr/share/icons/hicolor || true
fi
exit 0
