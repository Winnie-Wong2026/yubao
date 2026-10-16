#!/usr/bin/env bash
set -euo pipefail

root="/opt/yubao-dailyplan"
timestamp="$(date +%Y%m%d-%H%M%S)"
archive="$root/backups/yubao-data-${timestamp}.tgz"

install -d -m 0750 "$root/backups"
tar -C "$root" -czf "$archive" data uploads
sha256sum "$archive" > "${archive}.sha256"
find "$root/backups" -type f -name 'yubao-data-*' -mtime +14 -delete

printf '%s\n' "$archive"
