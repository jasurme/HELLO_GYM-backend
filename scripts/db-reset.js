#!/usr/bin/env node
// Rebuilds the database from db/*.sql: schema, views, triggers, then freshly
// generated seed data (dates relative to today).
//
//   npm run db:reset                 gym_db with seed data
//   npm run db:reset -- --no-seed    schema only
//   NODE_ENV=test npm run db:reset   the test database (gym_test)
const fs = require('fs');
const path = require('path');
const { connect, runSqlFile } = require('./lib/sql-runner');
const { generateSeed } = require('./generate-seed');
const env = require('../src/config/env');

const DB_DIR = path.join(__dirname, '..', 'db');
const SCHEMA_FILES = ['01_schema.sql', '02_views.sql', '03_triggers.sql'];

async function resetDatabase({ seed = true, log = console.log } = {}) {
  const conn = await connect();
  try {
    // Sessions point at user ids, which a reset reuses for different people.
    // Empty the table (rather than drop it) so a running server keeps working.
    const [sessionTable] = await conn.query("SHOW TABLES LIKE 'sessions'");
    if (sessionTable.length) await conn.query('DELETE FROM sessions');
    for (const file of SCHEMA_FILES) {
      const count = await runSqlFile(conn, path.join(DB_DIR, file));
      log(`  ${file.padEnd(16)} ${count} statements`);
    }
    if (!seed) return null;

    const result = generateSeed();
    const seedFile = path.join(DB_DIR, '04_seed.sql');
    fs.writeFileSync(seedFile, result.sql);
    const count = await runSqlFile(conn, seedFile);
    log(`  04_seed.sql      ${count} statements`);
    return result;
  } finally {
    await conn.end();
  }
}

if (require.main === module) {
  const seed = !process.argv.includes('--no-seed');
  console.log(`Resetting database '${env.db.name}'...`);
  resetDatabase({ seed })
    .then((result) => {
      if (result) {
        console.log('Loaded:', result.stats);
        console.log(`\nDemo password for every account: ${result.demoAccounts.password}`);
        console.log(`  admin    ${result.demoAccounts.admin}`);
        console.log(`  trainer  ${result.demoAccounts.trainer}`);
        for (const m of result.demoAccounts.members) console.log(`  member   ${m.email.padEnd(32)} ${m.story}`);
      }
      console.log('Done.');
    })
    .catch((err) => {
      console.error(err.message);
      if (err.code === 'ECONNREFUSED' || err.code === 'ENOENT') {
        console.error('\nIs MySQL running? Start it in System Settings → MySQL.');
      } else if (err.code === 'ER_ACCESS_DENIED_ERROR' || err.code === 'ER_BAD_DB_ERROR') {
        console.error('\nRun ./scripts/setup-mysql.sh once to create the database and user.');
      }
      process.exit(1);
    });
}

module.exports = { resetDatabase };
