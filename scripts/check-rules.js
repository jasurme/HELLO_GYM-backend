#!/usr/bin/env node
// Runs db/06_rule_tests.sql statement by statement and checks every
// "-- expect:" tag: R# / constraint-name statements must be rejected with
// that rule, "ok" statements must succeed. "-- show" results are printed.
// Exits with code 1 if any expectation fails.
const path = require('path');
const fs = require('fs');
const { connect, splitSql } = require('./lib/sql-runner');

const FILE = path.join(__dirname, '..', 'db', '06_rule_tests.sql');

function expectationOf(stmt) {
  const tag = stmt.match(/^\s*--\s*expect:\s*(\S+)\s*$/m);
  if (tag) return tag[1];
  return /^\s*--\s*show\s*$/m.test(stmt) ? 'show' : 'ok';
}

function describe(stmt) {
  const code = stmt.replace(/^\s*--.*$/gm, '').trim().replace(/\s+/g, ' ');
  return code.length > 90 ? `${code.slice(0, 87)}...` : code;
}

async function checkRules({ log = console.log } = {}) {
  const conn = await connect();
  const results = [];
  try {
    for (const stmt of splitSql(fs.readFileSync(FILE, 'utf8'))) {
      const expect = expectationOf(stmt);
      let error = null;
      let rows = null;
      try {
        [rows] = await conn.query(stmt);
      } catch (err) {
        error = err.message;
      }

      let passed;
      if (expect === 'ok' || expect === 'show') passed = !error;
      else if (/^R\d+$/.test(expect)) passed = Boolean(error && error.startsWith(`[${expect}]`));
      else passed = Boolean(error && error.includes(expect));

      results.push({ expect, passed, statement: describe(stmt), error });
      if (expect !== 'ok' && expect !== 'show') {
        log(`${passed ? 'PASS' : 'FAIL'}  ${expect.padEnd(20)} ${error || 'statement was NOT rejected'}`);
      } else if (!passed) {
        log(`FAIL  ${'ok'.padEnd(20)} ${describe(stmt)}\n      ${error}`);
      }
      if (expect === 'show' && Array.isArray(rows)) {
        log(`      ${describe(stmt)}`);
        for (const row of rows) log(`        ${JSON.stringify(row)}`);
      }
    }
  } finally {
    await conn.query('ROLLBACK').catch(() => {});
    await conn.end();
  }
  return results;
}

if (require.main === module) {
  checkRules()
    .then((results) => {
      const failed = results.filter((r) => !r.passed);
      const rules = results.filter((r) => r.expect !== 'ok' && r.expect !== 'show');
      console.log(`\n${rules.length - failed.filter((r) => rules.includes(r)).length}/${rules.length} rejections as expected, `
        + `${failed.length} failure(s) overall.`);
      process.exit(failed.length ? 1 : 0);
    })
    .catch((err) => {
      console.error(err.message);
      process.exit(1);
    });
}

module.exports = { checkRules };
