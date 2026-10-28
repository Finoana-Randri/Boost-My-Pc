#!/bin/bash
# Boost My Pc (.deb): runs after the files are removed.

# Delete the link to the binary
if type update-alternatives >/dev/null 2>&1; then
    update-alternatives --remove 'boost-my-pc' '/opt/Boost My Pc/boost-my-pc'
else
    rm -f '/usr/bin/boost-my-pc'
fi

# AppArmor profile added when installing (not on an upgrade: the new version installs it again).
if [ "$1" = "remove" ] || [ "$1" = "purge" ]; then
    if [ -e /etc/apparmor.d/boost-my-pc ]; then
        if hash apparmor_parser 2>/dev/null; then
            apparmor_parser -R /etc/apparmor.d/boost-my-pc 2>/dev/null || true
        fi
        rm -f /etc/apparmor.d/boost-my-pc
    fi
fi
exit 0
