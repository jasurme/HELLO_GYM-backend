const fs = require('fs');
const mysql = require('mysql2/promise');
const env = require('../../src/config/env');

// Splits a .sql file into statements the way the mysql client and Workbench
// do: `DELIMITER $$` switches the terminator so procedure/trigger bodies can
// contain semicolons. Comment-only lines never end a statement.
function splitSql(text) {
  const statements = [];
  let delimiter = ';';
  let buffer = [];

  const flush = () => {
    const stmt = buffer.join('\n').trim();
    buffer = [];
    const code = stmt.replace(/^\s*--.*$/gm, '').trim();
    if (code) statements.push(stmt);
  };

  for (const line of text.split(/\r?\n/)) {
    const directive = line.match(/^\s*DELIMITER\s+(\S+)\s*$/i);
    if (directive) {
      flush();
      delimiter = directive[1];
      continue;
    }
    if (/^\s*--/.test(line)) {
      buffer.push(line);
      continue;
    }
    const trimmed = line.trimEnd();
    if (trimmed.endsWith(delimiter)) {
      buffer.push(trimmed.slice(0, -delimiter.length));
      flush();
    } else {
      buffer.push(line);
    }
  }
  flush();
  return statements;
}

async function connect({ database = env.db.name } = {}) {
  const conn = await mysql.createConnection({
    database,
    user: env.db.user,
    password: env.db.password,
    socketPath: env.db.socketPath,
    host: env.db.host,
    port: env.db.port,
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
