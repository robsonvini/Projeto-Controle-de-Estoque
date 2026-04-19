const fs = require('fs/promises');
const path = require('path');

const CONFIG_PATH = path.resolve(__dirname, '../config.json');

const DEFAULT_CONFIG = {
    backupsDir: path.resolve(__dirname, '../backups'),
    maxBackups: 10,
    backupIntervalHours: 1
};

async function loadConfig() {
    try {
        const content = await fs.readFile(CONFIG_PATH, 'utf8');
        return JSON.parse(content);
    } catch (error) {
        if (error.code === 'ENOENT') {
            await saveConfig(DEFAULT_CONFIG);
            return DEFAULT_CONFIG;
        }
        throw error;
    }
}

async function saveConfig(config) {
    const normalized = { ...DEFAULT_CONFIG, ...config };
    const payload = `${JSON.stringify(normalized, null, 2)}\n`;
    await fs.writeFile(CONFIG_PATH, payload, 'utf8');
    return normalized;
}

async function ensureBackupsDir(dirPath) {
    try {
        await fs.mkdir(dirPath, { recursive: true });
        return true;
    } catch (error) {
        console.error('Erro ao criar diretório de backups:', error.message);
        return false;
    }
}

module.exports = {
    CONFIG_PATH,
    DEFAULT_CONFIG,
    loadConfig,
    saveConfig,
    ensureBackupsDir
};
