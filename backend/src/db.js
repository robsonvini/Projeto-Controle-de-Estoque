const fs = require('fs/promises');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'data', 'db.json');

async function ensureDbFile() {
  try {
    await fs.access(DB_PATH);
  } catch {
    const initial = { users: [], products: [], movements: [] };
    await fs.writeFile(DB_PATH, JSON.stringify(initial, null, 2), 'utf8');
  }
}

async function readDb() {
  await ensureDbFile();
  const raw = await fs.readFile(DB_PATH, 'utf8');
  const parsed = JSON.parse(raw);

  if (!Array.isArray(parsed.users)) parsed.users = [];
  if (!Array.isArray(parsed.products)) parsed.products = [];
  if (!Array.isArray(parsed.movements)) parsed.movements = [];

  return parsed;
}

async function writeDb(data) {
  await fs.writeFile(DB_PATH, JSON.stringify(data, null, 2), 'utf8');
}

module.exports = {
  readDb,
  writeDb
};
