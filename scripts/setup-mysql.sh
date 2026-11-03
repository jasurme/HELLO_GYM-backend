#!/usr/bin/env bash
# One-time MySQL setup for the Gym Booking System.
# Creates the app database, the test database, and a dedicated `gym_app` user,
# using the values in .env. It asks for your MySQL root password, which is
# typed into the mysql client and never stored in the project.
set -euo pipefail
cd "$(dirname "$0")/.."

if [ ! -f .env ]; then
  echo "No .env file found. Copy .env.example to .env and fill it in first." >&2
  exit 1
fi
set -a; . ./.env; set +a
MYSQL_BIN="${MYSQL_BIN:-/usr/local/mysql/bin/mysql}"

echo "Creating databases '${DB_NAME}', '${DB_TEST_NAME}' and user '${DB_USER}'@'localhost'."
echo "Enter your MySQL root password when asked."

"$MYSQL_BIN" -uroot -p <<SQL
CREATE DATABASE IF NOT EXISTS \`${DB_NAME}\`      CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
CREATE DATABASE IF NOT EXISTS \`${DB_TEST_NAME}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

CREATE USER IF NOT EXISTS '${DB_USER}'@'localhost' IDENTIFIED BY '${DB_PASSWORD}';
ALTER USER '${DB_USER}'@'localhost' IDENTIFIED BY '${DB_PASSWORD}';
GRANT ALL PRIVILEGES ON \`${DB_NAME}\`.*      TO '${DB_USER}'@'localhost';
GRANT ALL PRIVILEGES ON \`${DB_TEST_NAME}\`.* TO '${DB_USER}'@'localhost';

-- With binary logging on (the default), a non-SUPER user can only create
-- triggers when this is enabled; otherwise CREATE TRIGGER fails with error 1419.
SET PERSIST log_bin_trust_function_creators = 1;
SQL

echo "MySQL setup complete. Next: npm run db:reset"
