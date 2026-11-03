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

module.exports = { splitSql };
