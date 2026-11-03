const fs = require('fs');
const mysql = require('mysql2/promise');
const env = require('../../src/config/env');
const { splitSql } = require('../../src/lib/split-sql');

async function connect({ database = env.db.name } = {}) {
  const conn = await mysql.createConnection({
    database,
    user: env.db.user,
    password: env.db.password,
    socketPath: env.db.socketPath,
    host: env.db.host,
    port: env.db.port,
    charset: env.db.charset,
    dateStrings: true,
  });
  await conn.query('SET time_zone = ?', [env.timezone]);
  return conn;
}

async function runSqlFile(conn, file) {
  const statements = splitSql(fs.readFileSync(file, 'utf8'));
  for (const stmt of statements) {
    try {
      await conn.query(stmt);
    } catch (err) {
      err.message = `${file}: ${err.message}\n--- statement ---\n${stmt.slice(0, 400)}`;
      throw err;
    }
  }
  return statements.length;
}

module.exports = { splitSql, connect, runSqlFile };
