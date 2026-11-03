// Runs once before all test files: rebuilds the test database (gym_test)
// from the same SQL files and seed generator as the real one.
module.exports = async () => {
  process.env.NODE_ENV = 'test';
  const { resetDatabase } = require('../scripts/db-reset');
  await resetDatabase({ log: () => {} });
};
