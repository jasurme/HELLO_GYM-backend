const { QueryTypes } = require('sequelize');
const { sequelize } = require('../models');

const camel = (key) => key.replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase());

function camelize(row) {
  const out = {};
  for (const [key, value] of Object.entries(row)) out[camel(key)] = value;
  return out;
}

// Raw SELECT with named replacements (:name), rows returned with camelCase keys.
async function select(sql, replacements = {}, { transaction } = {}) {
  const rows = await sequelize.query(sql, { replacements, type: QueryTypes.SELECT, transaction });
  return rows.map(camelize);
}

async function selectOne(sql, replacements, options) {
  const rows = await select(sql, replacements, options);
  return rows[0] || null;
}

module.exports = { select, selectOne, camelize };
