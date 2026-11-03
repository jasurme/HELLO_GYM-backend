// Database-level business rules: runs db/06_rule_tests.sql against gym_test.
require('./helpers');
const { checkRules } = require('../scripts/check-rules');

describe('database triggers and constraints (db/06_rule_tests.sql)', () => {
  let results;

  beforeAll(async () => {
    results = await checkRules({ log: () => {} });
  });

  test('every tagged statement behaves as expected', () => {
    const failures = results.filter((r) => !r.passed)
      .map((r) => `${r.expect}: ${r.statement}\n  -> ${r.error || 'was not rejected'}`);
    expect(failures).toEqual([]);
  });

  test.each(['R1', 'R2', 'R3', 'R4', 'R5', 'R6', 'R8', 'R9', 'R10', 'R11', 'R12'])('rule %s is demonstrated and enforced', (rule) => {
    const cases = results.filter((r) => r.expect === rule);
    expect(cases.length).toBeGreaterThan(0);
    for (const c of cases) expect(c.error).toMatch(new RegExp(`^\\[${rule}\\]`));
  });

  test('CHECK and FOREIGN KEY constraints are demonstrated', () => {
    const constraints = results.filter((r) => /^(ck|fk)_/.test(r.expect));
    expect(constraints.map((c) => c.expect)).toEqual(expect.arrayContaining(['ck_bookings_length', 'ck_bookings_grid', 'fk_payments_subscription', 'ck_payments_amount']));
    for (const c of constraints) expect(c.passed).toBe(true);
  });
});
