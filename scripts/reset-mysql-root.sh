#!/usr/bin/env bash
# Sets a new MySQL root password when the old one is forgotten.
# For the official macOS MySQL package (/usr/local/mysql + launchd service).
# Needs your Mac password for sudo. No data is lost.
set -euo pipefail

MYSQL_DIR=/usr/local/mysql
PLIST=/Library/LaunchDaemons/com.oracle.oss.mysql.mysqld.plist
SERVICE=system/com.oracle.oss.mysql.mysqld

wait_until_stopped() {
  for _ in $(seq 1 60); do
    pgrep -x mysqld >/dev/null || return 0
    sleep 1
  done
  echo "MySQL did not stop within 60 seconds." >&2
  exit 1
}

read -rs -p "New MySQL root password: " PW; echo
read -rs -p "Type it again: " PW2; echo
if [ -z "$PW" ] || [ "$PW" != "$PW2" ]; then
  echo "The passwords are empty or do not match." >&2
  exit 1
fi

echo "Stopping MySQL (you may be asked for your Mac password)..."
sudo launchctl bootout "$SERVICE" 2>/dev/null || true
wait_until_stopped

echo "Starting MySQL temporarily without password checks (local socket only)..."
sudo -b "$MYSQL_DIR/bin/mysqld" --user=_mysql --basedir="$MYSQL_DIR" --datadir="$MYSQL_DIR/data" \
  --plugin-dir="$MYSQL_DIR/lib/plugin" --skip-grant-tables --skip-networking \
  --log-error="$MYSQL_DIR/data/mysqld.local.err" --pid-file="$MYSQL_DIR/data/mysqld.local.pid"
for _ in $(seq 1 60); do
  "$MYSQL_DIR/bin/mysqladmin" -uroot ping >/dev/null 2>&1 && break
  sleep 1
done

# Escape backslashes and quotes for the SQL string literal.
SQL_PW=${PW//\\/\\\\}
SQL_PW=${SQL_PW//\'/\\\'}
"$MYSQL_DIR/bin/mysql" -uroot <<SQL
FLUSH PRIVILEGES;
ALTER USER 'root'@'localhost' IDENTIFIED BY '${SQL_PW}';
SQL

echo "Restarting MySQL normally..."
MYSQL_PWD="$PW" "$MYSQL_DIR/bin/mysqladmin" -uroot shutdown || sudo pkill -x mysqld
wait_until_stopped
sudo launchctl bootstrap system "$PLIST"

echo "Root password changed. Now run: ./scripts/setup-mysql.sh"
