const env = require('./config/env');
const { sequelize } = require('./models');
const { createApp } = require('./app');

async function main() {
  try {
    await sequelize.authenticate();
  } catch (err) {
    console.error(`Cannot connect to MySQL database '${env.db.name}': ${err.message}`);
    console.error('Is MySQL running, and did you run ./scripts/setup-mysql.sh and npm run db:reset?');
    process.exit(1);
  }
  const app = createApp();
  app.listen(env.port, () => {
    console.log(`BinaryFit Gym is running at http://localhost:${env.port}`);
  });
}

main();
