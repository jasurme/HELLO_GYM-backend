#!/usr/bin/env bash
# Lets teammates connect to this Mac's MySQL over the network (for example
# MySQL Workbench on their own laptop).
#
# MySQL already listens on every interface (bind_address = *), so no my.cnf
# edit or restart is needed. What blocks remote logins is that every account
# is @localhost; this script creates ONE network account, `gym_team`, that may
# log in only from the given address range and only sees the gym_db database.
#
#   ./scripts/allow-remote-mysql.sh                  allow this Mac's current network (first two parts of its IP)
#   ./scripts/allow-remote-mysql.sh '165.246.%'      allow a range you choose ('%' = anywhere, not recommended)
#   ./scripts/allow-remote-mysql.sh --revoke [range] remove the account again
#
# Asks for the MySQL root password. The gym_team password is kept in .env.
set -euo pipefail
cd "$(dirname "$0")/.."

[ -f .env ] && { set -a; . ./.env; set +a; }
MYSQL_BIN="${MYSQL_BIN:-/usr/local/mysql/bin/mysql}"
REMOTE_USER=gym_team
DB="${DB_NAME:-gym_db}"
IP="$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || true)"
DEFAULT_RANGE="$(echo "$IP" | cut -d. -f1-2).%"

if [ "${1:-}" = "--revoke" ]; then
  RANGE="${2:-$DEFAULT_RANGE}"
  echo "Removing '${REMOTE_USER}'@'${RANGE}'. Enter your MySQL root password:"
  "$MYSQL_BIN" -uroot -p -e "DROP USER IF EXISTS '${REMOTE_USER}'@'${RANGE}';"
  echo "Done: remote access for ${REMOTE_USER}@${RANGE} is removed."
  exit 0
fi

RANGE="${1:-$DEFAULT_RANGE}"
if ! [[ "$RANGE" =~ ^[0-9.%]+$ ]]; then
  echo "The range may only contain digits, dots and %, for example 165.246.%" >&2
  exit 1
fi

# Reuse the saved password on reruns; otherwise make a new random one.
PASSWORD="${REMOTE_DB_PASSWORD:-$(openssl rand -base64 24 | tr -dc 'A-Za-z0-9' | cut -c1-20)}"

echo "Creating '${REMOTE_USER}'@'${RANGE}' with access to ${DB} only. Enter your MySQL root password:"
"$MYSQL_BIN" -uroot -p <<SQL
CREATE USER IF NOT EXISTS '${REMOTE_USER}'@'${RANGE}' IDENTIFIED BY '${PASSWORD}';
ALTER USER '${REMOTE_USER}'@'${RANGE}' IDENTIFIED BY '${PASSWORD}';
GRANT ALL PRIVILEGES ON \`${DB}\`.* TO '${REMOTE_USER}'@'${RANGE}';
SQL

if ! grep -q '^REMOTE_DB_PASSWORD=' .env 2>/dev/null; then
  printf '\n# Network account for teammates (scripts/allow-remote-mysql.sh)\nREMOTE_DB_USER=%s\nREMOTE_DB_PASSWORD=%s\nREMOTE_DB_RANGE=%s\n' \
    "$REMOTE_USER" "$PASSWORD" "$RANGE" >> .env
fi

cat <<INFO

Remote access is on. Teammates on the same network connect with:
  Host:      ${IP:-(the IP address of this Mac)}
  Port:      3306
  Username:  ${REMOTE_USER}
  Password:  ${PASSWORD}
  Schema:    ${DB}
Workbench: + next to "MySQL Connections", fill in the above, Test Connection.
This Mac must be awake and on the network; its IP can change after reconnecting.
Turn it off again with: ./scripts/allow-remote-mysql.sh --revoke ${RANGE}
INFO
