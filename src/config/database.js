const { Sequelize } = require('sequelize');
const env = require('./env');

// The schema is owned by db/*.sql (tables, CHECKs, views, triggers), so
// Sequelize maps to it but never runs sync() or migrations.
const sequelize = new Sequelize(env.db.name, env.db.user, env.db.password, {
  dialect: 'mysql',
  host: env.db.host,
  port: env.db.port,
  timezone: env.timezone,
  logging: process.env.SQL_LOG === '1' ? console.log : false,
  define: { underscored: true, freezeTableName: true },
  pool: { max: 10, min: 0, idle: 10000 },
  dialectOptions: {
    socketPath: env.db.socketPath,
    charset: env.db.charset,
    // Dates come back as the local wall-clock strings MySQL stores
    // ("2026-11-07 11:30:00") instead of being shifted into JS Dates.
    // SUM()/AVG() results arrive as DECIMAL; return them as numbers.
    typeCast(field, next) {
      switch (field.type) {
        case 'DATETIME':
        case 'TIMESTAMP':
        case 'DATE':
        case 'TIME':
          return field.string();
        case 'NEWDECIMAL': {
          const value = field.string();
          return value === null ? null : Number(value);
        }
        case 'TINY':
          if (field.length === 1) {
            const value = field.string();
            return value === null ? null : value === '1';
          }
          return next();
        default:
          return next();
      }
    },
  },
});

// READ COMMITTED for every app connection. At MySQL's default (REPEATABLE
// READ) the SELECTs inside our triggers take shared gap locks, so two
// concurrent inserts into the same index gap (e.g. subscriptions for two new
// members) deadlock. Concurrency for the business rules is instead handled by
// explicit row locks: trainer + member rows for bookings, the member row for
// subscriptions (R6) and the subscription row for payments (R9).
sequelize.addHook('afterConnect', (connection) => new Promise((resolve, reject) => {
  connection.query("SET SESSION transaction_isolation = 'READ-COMMITTED'", (err) => (err ? reject(err) : resolve()));
}));

module.exports = sequelize;
