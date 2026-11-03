const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env'), quiet: true });

// The gym runs on local wall-clock time; Node, MySQL sessions and the seed
// data all use the same zone so DATETIME values mean the same thing everywhere.
process.env.TZ = process.env.TZ || 'Asia/Seoul';

const isTest = process.env.NODE_ENV === 'test';

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name} in .env (see .env.example)`);
  return value;
}

// "+09:00" style offset for SET time_zone / Sequelize.
function utcOffset(date = new Date()) {
  const minutes = -date.getTimezoneOffset();
  const sign = minutes >= 0 ? '+' : '-';
  const abs = Math.abs(minutes);
  return `${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
}

module.exports = {
  isTest,
  port: Number(process.env.PORT || 3000),
  sessionSecret: isTest ? 'test-secret' : required('SESSION_SECRET'),
  timezone: utcOffset(),
  db: {
    name: isTest ? required('DB_TEST_NAME') : required('DB_NAME'),
    user: required('DB_USER'),
    password: process.env.DB_PASSWORD || '',
    socketPath: process.env.DB_SOCKET || undefined,
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 3306),
  },
};
