const fs = require('fs/promises');
const path = require('path');

const DB_PATH = path.resolve(__dirname, '../data/db.json');

const EMPTY_DB = {
    users: [],
    products: [],
    movements: [],
    loans: []
};

function normalizeDbShape(db) {
    return {
        users: Array.isArray(db?.users) ? db.users : [],
        products: Array.isArray(db?.products) ? db.products : [],
        movements: Array.isArray(db?.movements) ? db.movements : [],
        loans: Array.isArray(db?.loans) ? db.loans : []
    };
}

async function readDb() {
    try {
        const content = await fs.readFile(DB_PATH, 'utf8');
        const parsed = JSON.parse(content);
        return normalizeDbShape(parsed);
    } catch (error) {
        if (error.code === 'ENOENT') {
            await writeDb(EMPTY_DB);
            return normalizeDbShape(EMPTY_DB);
        }

        throw error;
    }
}

async function writeDb(db) {
    const normalized = normalizeDbShape(db);
    const payload = `${JSON.stringify(normalized, null, 2)}\n`;
    await fs.writeFile(DB_PATH, payload, 'utf8');
}

module.exports = {
    DB_PATH,
    EMPTY_DB,
    readDb,
    writeDb
};