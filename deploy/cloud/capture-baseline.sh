#!/usr/bin/env bash
set -euo pipefail

timestamp="$(date +%Y%m%d-%H%M%S)"
backup_dir="/opt/yubao-dailyplan/backups/predeploy-${timestamp}"

install -d -m 0750 "$backup_dir"
cp -a /etc/os-release "$backup_dir/os-release"
rpm -qa | sort > "$backup_dir/packages.txt"
ss -lntup > "$backup_dir/listeners.txt"
systemctl list-unit-files --type=service > "$backup_dir/services.txt"
find /etc -maxdepth 2 \( -path '/etc/caddy*' -o -path '/etc/nginx*' \) -print > "$backup_dir/web-config-paths.txt"
find /opt /srv -maxdepth 3 -type d -print > "$backup_dir/application-paths.txt"
sha256sum "$backup_dir"/*.txt "$backup_dir/os-release" > "$backup_dir/SHA256SUMS"
chmod -R go-rwx "$backup_dir"

printf '%s\n' "$backup_dir"
