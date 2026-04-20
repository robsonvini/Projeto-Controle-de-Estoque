const fs = require('fs/promises');
const path = require('path');

const cors = require('cors');
const express = require('express');
const helmet = require('helmet');
const multer = require('multer');
const morgan = require('morgan');
const { XMLParser } = require('fast-xml-parser');
const XLSX = require('xlsx');
const PDFDocument = require('pdfkit');
const pdfParse = require('pdf-parse');

const { authenticateToken, comparePassword, hashPassword, signToken } = require('./auth');
const { readDb, writeDb, DB_PATH } = require('./db');
const { loadConfig, saveConfig, ensureBackupsDir, DEFAULT_CONFIG } = require('./config');

const app = express();
const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || '0.0.0.0';
const projectRoot = path.resolve(__dirname, '../..');
const upload = multer({ storage: multer.memoryStorage() });

let appConfig = { ...DEFAULT_CONFIG };
let BACKUPS_DIR = appConfig.backupsDir;
let MAX_BACKUPS = appConfig.maxBackups;
let BACKUP_INTERVAL_MS = appConfig.backupIntervalHours * 60 * 60 * 1000;
let BACKUP_MODE = appConfig.backupMode;
let BACKUP_SCHEDULE_DAY = appConfig.backupScheduleDay;
let BACKUP_SCHEDULE_TIME = appConfig.backupScheduleTime;
let backupScheduler = null;
let lastScheduledBackupKey = '';

const xmlParser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_'
});

const PRODUCT_CATEGORIES = ['Eletrônicos', 'Material de escritório', 'Armazenamento', 'Periféricos', 'Suprimentos de Impressão'];

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: process.env.CORS_ORIGIN === '*' ? true : (process.env.CORS_ORIGIN || true) }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(morgan('dev'));
app.use(express.static(projectRoot));

function createTimestamp() {
    return new Date().toISOString();
}

function formatDateBR(date = new Date()) {
    const instance = date instanceof Date ? date : new Date(date);
    return new Intl.DateTimeFormat('pt-BR').format(instance);
}

function parseNumber(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function parseFlexibleNumber(value, fallback = NaN) {
    if (typeof value === 'number') {
        return Number.isFinite(value) ? value : fallback;
    }

    const text = String(value ?? '').trim();
    if (!text) {
        return fallback;
    }

    const normalized = text
        .replace(/\s+/g, '')
        .replace(/[R$€£]/gi, '')
        .replace(/\.(?=\d{3}(\D|$))/g, '')
        .replace(',', '.');

    const parsed = Number(normalized.replace(/[^\d.-]/g, ''));
    return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeBackupMode(value) {
    const mode = String(value || '').trim().toLowerCase();
    return mode === 'automatic' ? 'automatic' : 'manual';
}

function normalizeScheduleDay(value) {
    const day = Number(value);
    return Number.isInteger(day) && day >= 0 && day <= 6 ? day : null;
}

function normalizeScheduleTime(value) {
    const text = String(value || '').trim();
    if (!/^\d{2}:\d{2}$/.test(text)) {
        return null;
    }

    const [hoursText, minutesText] = text.split(':');
    const hours = Number(hoursText);
    const minutes = Number(minutesText);

    if (!Number.isInteger(hours) || hours < 0 || hours > 23) {
        return null;
    }

    if (!Number.isInteger(minutes) || minutes < 0 || minutes > 59) {
        return null;
    }

    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function applyBackupRuntimeConfig(config) {
    BACKUPS_DIR = config.backupsDir;
    MAX_BACKUPS = config.maxBackups;
    BACKUP_INTERVAL_MS = config.backupIntervalHours * 60 * 60 * 1000;
    BACKUP_MODE = normalizeBackupMode(config.backupMode);
    BACKUP_SCHEDULE_DAY = normalizeScheduleDay(config.backupScheduleDay) ?? DEFAULT_CONFIG.backupScheduleDay;
    BACKUP_SCHEDULE_TIME = normalizeScheduleTime(config.backupScheduleTime) || DEFAULT_CONFIG.backupScheduleTime;
}

async function runScheduledBackupIfNeeded(now = new Date()) {
    if (BACKUP_MODE !== 'automatic') {
        return;
    }

    const currentDay = now.getDay();
    const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    if (currentDay !== BACKUP_SCHEDULE_DAY || currentTime !== BACKUP_SCHEDULE_TIME) {
        return;
    }

    const executionKey = `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}-${currentTime}`;
    if (lastScheduledBackupKey === executionKey) {
        return;
    }

    lastScheduledBackupKey = executionKey;
    await createBackup();
}

function startBackupScheduler() {
    if (backupScheduler) {
        clearInterval(backupScheduler);
        backupScheduler = null;
    }

    backupScheduler = setInterval(() => {
        runScheduledBackupIfNeeded().catch((error) => {
            console.error('✗ Falha no agendamento de backup:', error.message);
        });
    }, 30 * 1000);
}

function buildError(message, status = 400) {
    const error = new Error(message);
    error.status = status;
    return error;
}

function sendError(res, error) {
    const status = error.status || 500;
    const message = status >= 500 ? 'Erro interno do servidor.' : error.message;
    return res.status(status).json({ error: message });
}

function normalizeEmail(email) {
    return String(email || '').trim().toLowerCase();
}

function normalizeText(value) {
    return String(value ?? '').trim();
}

function normalizeCategory(value) {
    const text = normalizeText(value);
    if (!text) {
        return '';
    }

    const normalized = text
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase();

    if (normalized === 'eletronicos') {
        return 'Eletrônicos';
    }

    if (normalized === 'material de escritorio') {
        return 'Material de escritório';
    }

    if (normalized === 'informatica' || normalized === 'armazenamento') {
        return 'Armazenamento';
    }

    if (normalized === 'suprimentos de impressao') {
        return 'Suprimentos de Impressão';
    }

    if (normalized === 'toner') {
        return 'Suprimentos de Impressão';
    }

    return text;
}

function getFieldValue(source, candidates) {
    if (!source || typeof source !== 'object') {
        return undefined;
    }

    const entries = Object.entries(source);

    for (const candidate of candidates) {
        const lowerCandidate = String(candidate).toLowerCase();

        for (const [key, value] of entries) {
            if (String(key).toLowerCase() === lowerCandidate && value !== undefined && value !== null && value !== '') {
                return value;
            }
        }
    }

    return undefined;
}

function toProductPayload(input) {
    const nome = normalizeText(getFieldValue(input, ['nome', 'name', 'produto']));
    const patrimonio = normalizeText(getFieldValue(input, ['patrimonio', 'patrimônio', 'numeroPatrimonio', 'numero_patrimonio', 'assetNumber', 'asset_number']));
    const categoria = normalizeCategory(getFieldValue(input, ['categoria', 'category']));
    const quantidade = parseFlexibleNumber(getFieldValue(input, ['quantidade', 'quantity', 'qtd']), NaN);
    const preco = parseFlexibleNumber(getFieldValue(input, ['preco', 'price', 'preço']), NaN);
    const descricao = normalizeText(getFieldValue(input, ['descricao', 'description']));

    if (!nome || !categoria || !PRODUCT_CATEGORIES.includes(categoria)) {
        throw buildError('Produto inválido: nome e categoria são obrigatórios.');
    }

    if (!Number.isFinite(quantidade) || quantidade < 0) {
        throw buildError('Produto inválido: quantidade deve ser um número maior ou igual a zero.');
    }

    if (!Number.isFinite(preco) || preco < 0) {
        throw buildError('Produto inválido: preço deve ser um número maior ou igual a zero.');
    }

    return {
        nome,
        patrimonio,
        categoria,
        quantidade: Math.trunc(quantidade),
        preco: Number(preco.toFixed(2)),
        descricao
    };
}

function findPatrimonioCollision(products, patrimonio, excludedProductId = null) {
    const patrimonioText = normalizeText(patrimonio).toLowerCase();
    if (!patrimonioText) {
        return null;
    }

    return products.find((item) => {
        if (excludedProductId && Number(item.id) === Number(excludedProductId)) {
            return false;
        }

        return normalizeText(item.patrimonio).toLowerCase() === patrimonioText;
    }) || null;
}

function normalizeProductsList(items) {
    if (!Array.isArray(items)) {
        return [];
    }

    return items.map((item) => toProductPayload(item));
}

function createProductRecord(input, userId, existing = null) {
    const payload = toProductPayload(input);
    const now = createTimestamp();

    return {
        id: existing?.id || Date.now(),
        userId,
        ...payload,
        patrimonio: payload.patrimonio || existing?.patrimonio || '',
        dataCriacao: existing?.dataCriacao || formatDateBR(now),
        dataAtualizacao: formatDateBR(now),
        createdAt: existing?.createdAt || now,
        updatedAt: now
    };
}

function createMovementRecord({ userId, product, type, quantity, reason, previousStock, newStock }) {
    return {
        id: Date.now(),
        userId,
        productId: product.id,
        productName: product.nome,
        type,
        quantity,
        reason,
        previousStock,
        newStock,
        createdAt: createTimestamp()
    };
}

function extractProductsFromUnknownShape(source) {
    if (!source) {
        return [];
    }

    if (Array.isArray(source)) {
        return source.flatMap((item) => extractProductsFromUnknownShape(item));
    }

    if (typeof source !== 'object') {
        return [];
    }

    if (
        Object.prototype.hasOwnProperty.call(source, 'nome') ||
        Object.prototype.hasOwnProperty.call(source, 'name') ||
        Object.prototype.hasOwnProperty.call(source, 'categoria') ||
        Object.prototype.hasOwnProperty.call(source, 'category')
    ) {
        return [source];
    }

    return Object.values(source).flatMap((value) => extractProductsFromUnknownShape(value));
}

function parseImportProductsPayload(payload) {
    if (Array.isArray(payload)) {
        return payload;
    }

    if (Array.isArray(payload?.products)) {
        return payload.products;
    }

    if (Array.isArray(payload?.produtos)) {
        return payload.produtos;
    }

    return extractProductsFromUnknownShape(payload);
}

async function loadUserState(userId) {
    const db = await readDb();
    return {
        db,
        user: db.users.find((item) => item.id === userId) || null,
        products: db.products.filter((item) => item.userId === userId),
        movements: db.movements.filter((item) => item.userId === userId)
    };
}

async function migrateDbCategories() {
    const db = await readDb();
    let hasChanges = false;

    db.products = db.products.map((product) => {
        const normalizedCategory = normalizeCategory(product.categoria);
        if (normalizedCategory !== product.categoria) {
            hasChanges = true;
        }

        return {
            ...product,
            categoria: normalizedCategory || product.categoria || ''
        };
    });

    if (hasChanges) {
        await writeDb(db);
    }
}

async function createBackup() {
    try {
        await fs.mkdir(BACKUPS_DIR, { recursive: true });
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const backupName = `db-backup-${timestamp}.json`;
        const backupPath = path.join(BACKUPS_DIR, backupName);
        
        const content = await fs.readFile(DB_PATH, 'utf8');
        await fs.writeFile(backupPath, content, 'utf8');
        
        console.log(`✓ Backup criado: ${backupName}`);
        await cleanOldBackups();
        return { success: true, backupName };
    } catch (error) {
        console.error('✗ Erro ao criar backup:', error.message);
        return { success: false, error: error.message };
    }
}

async function cleanOldBackups() {
    try {
        const files = await fs.readdir(BACKUPS_DIR);
        const backupFiles = files
            .filter((f) => f.startsWith('db-backup-') && f.endsWith('.json'))
            .sort()
            .reverse();

        if (backupFiles.length > MAX_BACKUPS) {
            const filesToRemove = backupFiles.slice(MAX_BACKUPS);
            for (const file of filesToRemove) {
                await fs.unlink(path.join(BACKUPS_DIR, file));
            }
            console.log(`✓ Removidos ${filesToRemove.length} backup(s) antigo(s)`);
        }
    } catch (error) {
        console.error('✗ Erro ao limpar backups antigos:', error.message);
    }
}

async function listBackups() {
    try {
        await fs.mkdir(BACKUPS_DIR, { recursive: true });
        const files = await fs.readdir(BACKUPS_DIR);
        const backupFiles = files
            .filter((f) => f.startsWith('db-backup-') && f.endsWith('.json'))
            .sort()
            .reverse();

        const backups = await Promise.all(
            backupFiles.map(async (file) => {
                const filePath = path.join(BACKUPS_DIR, file);
                const stat = await fs.stat(filePath);
                return {
                    filename: file,
                    size: stat.size,
                    createdAt: stat.mtime.toISOString()
                };
            })
        );

        return backups;
    } catch (error) {
        console.error('✗ Erro ao listar backups:', error.message);
        return [];
    }
}

async function restoreBackup(filename) {
    try {
        const backupPath = path.join(BACKUPS_DIR, filename);
        
        const files = await fs.readdir(BACKUPS_DIR);
        if (!files.includes(filename) || !filename.startsWith('db-backup-') || !filename.endsWith('.json')) {
            throw new Error('Arquivo de backup inválido.');
        }

        const backupContent = await fs.readFile(backupPath, 'utf8');
        JSON.parse(backupContent);
        
        await fs.writeFile(DB_PATH, backupContent, 'utf8');
        console.log(`✓ Backup restaurado: ${filename}`);
        
        return { success: true, message: `Backup ${filename} restaurado com sucesso.` };
    } catch (error) {
        console.error('✗ Erro ao restaurar backup:', error.message);
        return { success: false, error: error.message };
    }
}

app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: createTimestamp() });
});

app.post('/api/auth/register', async (req, res) => {
    try {
        const name = normalizeText(req.body?.name);
        const email = normalizeEmail(req.body?.email);
        const password = String(req.body?.password || '');

        if (!name || !email || !password) {
            throw buildError('Informe nome, e-mail e senha válidos.');
        }

        if (password.length < 8) {
            throw buildError('A senha deve ter pelo menos 8 caracteres.');
        }

        const db = await readDb();
        if (db.users.some((user) => user.email === email)) {
            throw buildError('Já existe uma conta com esse e-mail.', 409);
        }

        const now = createTimestamp();
        const user = {
            id: Date.now(),
            name,
            email,
            passwordHash: await hashPassword(password),
            createdAt: now,
            updatedAt: now
        };

        db.users.push(user);
        await writeDb(db);

        res.status(201).json({
            user: {
                id: user.id,
                name: user.name,
                email: user.email
            }
        });
    } catch (error) {
        sendError(res, error);
    }
});

app.post('/api/auth/login', async (req, res) => {
    try {
        const email = normalizeEmail(req.body?.email);
        const password = String(req.body?.password || '');

        if (!email || !password) {
            throw buildError('Informe e-mail e senha válidos.');
        }

        const db = await readDb();
        const user = db.users.find((item) => item.email === email);

        if (!user || !(await comparePassword(password, user.passwordHash))) {
            throw buildError('Credenciais inválidas.', 401);
        }

        const token = signToken(user);

        res.json({
            token,
            user: {
                id: user.id,
                name: user.name,
                email: user.email
            }
        });
    } catch (error) {
        sendError(res, error);
    }
});

app.post('/api/auth/recover', async (req, res) => {
    try {
        const email = normalizeEmail(req.body?.email);
        const newPassword = String(req.body?.newPassword || '');

        if (!email || !newPassword) {
            throw buildError('Informe e-mail e nova senha válidos.');
        }

        const db = await readDb();
        const user = db.users.find((item) => item.email === email);

        if (!user) {
            throw buildError('Usuário não encontrado.', 404);
        }

        user.passwordHash = await hashPassword(newPassword);
        user.updatedAt = createTimestamp();

        await writeDb(db);

        res.json({
            message: 'Senha atualizada com sucesso.'
        });
    } catch (error) {
        sendError(res, error);
    }
});

app.get('/api/products', authenticateToken, async (req, res) => {
    try {
        const { products } = await loadUserState(req.auth.id);
        products.sort((a, b) => Number(b.updatedAt ? new Date(b.updatedAt) : 0) - Number(a.updatedAt ? new Date(a.updatedAt) : 0));
        res.json(products);
    } catch (error) {
        sendError(res, error);
    }
});

app.post('/api/products', authenticateToken, async (req, res) => {
    try {
        const db = await readDb();
        const userProducts = db.products.filter((item) => item.userId === req.auth.id);
        const patrimonio = normalizeText(req.body?.patrimonio);

        const collision = findPatrimonioCollision(userProducts, patrimonio);
        if (collision) {
            throw buildError('Já existe um produto com esse número de patrimônio.', 409);
        }

        const product = createProductRecord(req.body, req.auth.id);

        db.products = db.products.filter((item) => item.userId !== req.auth.id);
        db.products.push(product, ...userProducts);
        await writeDb(db);

        res.status(201).json(product);
    } catch (error) {
        sendError(res, error);
    }
});

app.put('/api/products/:id', authenticateToken, async (req, res) => {
    try {
        const productId = Number(req.params.id);
        const db = await readDb();
        const product = db.products.find((item) => item.id === productId && item.userId === req.auth.id);

        if (!product) {
            throw buildError('Produto não encontrado.', 404);
        }

        const patrimonio = normalizeText(req.body?.patrimonio);

        const userProducts = db.products.filter((item) => item.userId === req.auth.id);
        const collision = findPatrimonioCollision(userProducts, patrimonio, productId);
        if (collision) {
            throw buildError('Já existe um produto com esse número de patrimônio.', 409);
        }

        const updated = createProductRecord(req.body, req.auth.id, product);
        Object.assign(product, updated, { id: product.id, userId: product.userId, createdAt: product.createdAt, dataCriacao: product.dataCriacao });

        await writeDb(db);
        res.json(product);
    } catch (error) {
        sendError(res, error);
    }
});

app.delete('/api/products/:id', authenticateToken, async (req, res) => {
    try {
        const productId = Number(req.params.id);
        const db = await readDb();
        const originalLength = db.products.length;
        db.products = db.products.filter((item) => !(item.id === productId && item.userId === req.auth.id));

        if (db.products.length === originalLength) {
            throw buildError('Produto não encontrado.', 404);
        }

        await writeDb(db);
        res.status(204).send();
    } catch (error) {
        sendError(res, error);
    }
});

async function replaceUserProducts(userId, items) {
    const db = await readDb();
    const keepOtherProducts = db.products.filter((item) => item.userId !== userId);
    const currentProducts = db.products.filter((item) => item.userId === userId);
    const now = createTimestamp();
    const normalized = normalizeProductsList(items).map((item, index) => {
        const original = currentProducts[index] || null;
        return createProductRecord(item, userId, original || { createdAt: now, dataCriacao: formatDateBR(now) });
    });

    db.products = [...keepOtherProducts, ...normalized];
    await writeDb(db);

    return normalized;
}

app.post('/api/products/import', authenticateToken, async (req, res) => {
    try {
        const imported = await replaceUserProducts(req.auth.id, parseImportProductsPayload(req.body));
        res.json({ imported: imported.length, products: imported });
    } catch (error) {
        sendError(res, error);
    }
});

app.post('/api/products/import/xml', authenticateToken, async (req, res) => {
    try {
        const xmlText = String(req.body?.xml || '');

        if (!xmlText.trim()) {
            throw buildError('Arquivo XML vazio.');
        }

        const parsed = xmlParser.parse(xmlText);
        const imported = await replaceUserProducts(req.auth.id, parseImportProductsPayload(parsed));
        res.json({ imported: imported.length, products: imported });
    } catch (error) {
        sendError(res, error);
    }
});

app.post('/api/products/import/file', authenticateToken, upload.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            throw buildError('Arquivo não enviado.');
        }

        const extension = path.extname(req.file.originalname || '').toLowerCase();
        let items = [];

        if (extension === '.xlsx' || extension === '.xls') {
            const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
            const sheetName = workbook.SheetNames[0];
            const sheet = workbook.Sheets[sheetName];
            items = XLSX.utils.sheet_to_json(sheet, { defval: '' });
        } else if (extension === '.pdf') {
            const parsed = await pdfParse(req.file.buffer);
            const lines = String(parsed.text || '')
                .split(/\r?\n/)
                .map((line) => line.trim())
                .filter(Boolean);

            if (lines.length >= 2) {
                const headers = lines.shift().split(/\s{2,}|\t|\|/).map((item) => item.trim()).filter(Boolean);
                items = lines.map((line) => {
                    const values = line.split(/\s{2,}|\t|\|/).map((item) => item.trim());
                    const record = {};
                    headers.forEach((header, index) => {
                        record[header] = values[index] ?? '';
                    });
                    return record;
                });
            }
        } else {
            throw buildError('Formato não suportado. Use XLSX, XLS ou PDF.');
        }

        const imported = await replaceUserProducts(req.auth.id, items);
        res.json({ imported: imported.length, products: imported });
    } catch (error) {
        sendError(res, error);
    }
});

app.get('/api/movements', authenticateToken, async (req, res) => {
    try {
        const { movements } = await loadUserState(req.auth.id);
        let list = [...movements];

        if (req.query.productId) {
            list = list.filter((item) => String(item.productId) === String(req.query.productId));
        }

        if (req.query.type) {
            list = list.filter((item) => item.type === req.query.type);
        }

        if (req.query.from) {
            const fromDate = new Date(req.query.from);
            if (!Number.isNaN(fromDate.getTime())) {
                list = list.filter((item) => new Date(item.createdAt).getTime() >= fromDate.getTime());
            }
        }

        if (req.query.to) {
            const toDate = new Date(req.query.to);
            if (!Number.isNaN(toDate.getTime())) {
                list = list.filter((item) => new Date(item.createdAt).getTime() <= toDate.getTime());
            }
        }

        list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
        res.json(list);
    } catch (error) {
        sendError(res, error);
    }
});

app.post('/api/products/:id/movements', authenticateToken, async (req, res) => {
    try {
        const productId = Number(req.params.id);
        const type = normalizeText(req.body?.type);
        const quantity = Math.trunc(parseNumber(req.body?.quantity, NaN));
        const reason = normalizeText(req.body?.reason);

        if (!productId || !type || !['entrada', 'saida'].includes(type)) {
            throw buildError('Tipo de movimentação inválido.');
        }

        if (!Number.isFinite(quantity) || quantity < 1) {
            throw buildError('Quantidade inválida.');
        }

        if (!reason) {
            throw buildError('Informe um motivo para a movimentação.');
        }

        const db = await readDb();
        const product = db.products.find((item) => item.id === productId && item.userId === req.auth.id);

        if (!product) {
            throw buildError('Produto não encontrado.', 404);
        }

        const previousStock = parseNumber(product.quantidade, 0);
        const delta = type === 'entrada' ? quantity : -quantity;
        const newStock = previousStock + delta;

        if (newStock < 0) {
            throw buildError('Estoque insuficiente para registrar saída.');
        }

        product.quantidade = newStock;
        product.dataAtualizacao = formatDateBR();
        product.updatedAt = createTimestamp();

        const movement = createMovementRecord({
            userId: req.auth.id,
            product,
            type,
            quantity,
            reason,
            previousStock,
            newStock
        });

        db.movements.unshift(movement);
        await writeDb(db);

        res.status(201).json({
            movement,
            product
        });
    } catch (error) {
        sendError(res, error);
    }
});

async function buildProductsWorkbook(userId) {
    const { products } = await loadUserState(userId);
    // Evita que textos começando com =, +, -, @ sejam interpretados como fórmulas no Excel.
    const toSafeExcelText = (value) => {
        const text = String(value ?? '').trim();
        if (!text) {
            return '';
        }

        return /^[=+\-@]/.test(text) ? `'${text}` : text;
    };

    const rows = products.map((product) => {
        const id = Number(product.id);
        const quantidade = Number(product.quantidade);
        const preco = Number(product.preco);

        return [
            Number.isFinite(id) ? id : toSafeExcelText(product.id),
            toSafeExcelText(product.nome),
            toSafeExcelText(product.patrimonio || 'Sem patrimônio'),
            toSafeExcelText(product.categoria),
            Number.isFinite(quantidade) ? quantidade : 0,
            Number.isFinite(preco) ? Number(preco.toFixed(2)) : 0,
            toSafeExcelText(product.descricao),
            toSafeExcelText(product.dataCriacao),
            toSafeExcelText(product.dataAtualizacao)
        ];
    });

    const worksheet = XLSX.utils.aoa_to_sheet([
        ['ID', 'Nome', 'Patrimonio', 'Categoria', 'Quantidade', 'Preco', 'Descricao', 'DataCriacao', 'DataAtualizacao'],
        ...rows
    ]);

    worksheet['!cols'] = [
        { wch: 12 },
        { wch: 28 },
        { wch: 20 },
        { wch: 22 },
        { wch: 12 },
        { wch: 12 },
        { wch: 40 },
        { wch: 16 },
        { wch: 16 }
    ];

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Produtos');
    return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx', compression: true });
}

function buildProductsPdf(products) {
    return new Promise((resolve, reject) => {
        const doc = new PDFDocument({ margin: 36, size: 'A4', layout: 'landscape' });
        const chunks = [];

        doc.on('data', (chunk) => chunks.push(chunk));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', reject);

        doc.fontSize(18).text('Relatório de Produtos', { align: 'center' });
        doc.moveDown(0.5);
        doc.fontSize(10).text(`Gerado em ${new Date().toLocaleString('pt-BR')}`, { align: 'center' });
        doc.moveDown(1);

        const columns = [
            { label: 'Nome', key: 'nome', width: 170 },
            { label: 'Patrim.', key: 'patrimonio', width: 100 },
            { label: 'Categoria', key: 'categoria', width: 100 },
            { label: 'Qtd.', key: 'quantidade', width: 50 },
            { label: 'Preço', key: 'preco', width: 80 },
            { label: 'Atualização', key: 'dataAtualizacao', width: 100 }
        ];

        let x = doc.page.margins.left;
        let y = doc.y;
        const rowHeight = 22;

        const drawRow = (cells, isHeader = false) => {
            x = doc.page.margins.left;

            cells.forEach((cell, index) => {
                const column = columns[index];
                doc.rect(x, y, column.width, rowHeight).stroke();
                doc.fontSize(isHeader ? 10 : 9).text(String(cell ?? ''), x + 4, y + 6, {
                    width: column.width - 8,
                    ellipsis: true
                });
                x += column.width;
            });

            y += rowHeight;

            if (y > doc.page.height - doc.page.margins.bottom - rowHeight) {
                doc.addPage();
                y = doc.page.margins.top;
            }
        };

        drawRow(columns.map((column) => column.label), true);

        products.forEach((product) => {
            drawRow([
                product.nome,
                product.patrimonio || 'Sem patrimônio',
                product.categoria,
                product.quantidade,
                Number(product.preco || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }),
                product.dataAtualizacao || product.dataCriacao || ''
            ]);
        });

        doc.end();
    });
}

app.get('/api/products/export/xlsx', authenticateToken, async (req, res) => {
    try {
        const buffer = await buildProductsWorkbook(req.auth.id);
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename="estoque.xlsx"');
        res.send(buffer);
    } catch (error) {
        sendError(res, error);
    }
});

app.get('/api/products/export/pdf', authenticateToken, async (req, res) => {
    try {
        const { products } = await loadUserState(req.auth.id);
        const buffer = await buildProductsPdf(products);
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', 'attachment; filename="estoque.pdf"');
        res.send(buffer);
    } catch (error) {
        sendError(res, error);
    }
});

app.get('/', (req, res) => {
    res.sendFile(path.join(projectRoot, 'index.html'));
});

app.get('/api/backups', authenticateToken, async (req, res) => {
    try {
        const backups = await listBackups();
        res.json({ backups });
    } catch (error) {
        sendError(res, error);
    }
});

app.post('/api/backups/create-now', authenticateToken, async (req, res) => {
    try {
        const result = await createBackup();
        if (result.success) {
            res.status(201).json({ message: `Backup ${result.backupName} criado com sucesso.`, backupName: result.backupName });
        } else {
            throw buildError(result.error || 'Erro ao criar backup.');
        }
    } catch (error) {
        sendError(res, error);
    }
});

app.post('/api/backups/export', authenticateToken, async (req, res) => {
    try {
        const db = await readDb();
        const backupName = `backup-manual-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
        const content = JSON.stringify(db, null, 2);

        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${backupName}"`);
        res.send(content);
    } catch (error) {
        sendError(res, error);
    }
});

app.post('/api/backups/restore', authenticateToken, async (req, res) => {
    try {
        const filename = String(req.body?.filename || '').trim();
        if (!filename) {
            throw buildError('Informe o nome do arquivo de backup.');
        }

        const result = await restoreBackup(filename);
        if (result.success) {
            res.json(result);
        } else {
            throw buildError(result.error || 'Erro ao restaurar backup.');
        }
    } catch (error) {
        sendError(res, error);
    }
});

app.get('/api/backups/config', authenticateToken, async (req, res) => {
    try {
        res.json({
            backupsDir: appConfig.backupsDir,
            maxBackups: appConfig.maxBackups,
            backupIntervalHours: appConfig.backupIntervalHours,
            backupMode: BACKUP_MODE,
            backupScheduleDay: BACKUP_SCHEDULE_DAY,
            backupScheduleTime: BACKUP_SCHEDULE_TIME
        });
    } catch (error) {
        sendError(res, error);
    }
});

app.put('/api/backups/config', authenticateToken, async (req, res) => {
    try {
        const rawBackupsDir = req.body?.backupsDir;
        const rawMaxBackups = req.body?.maxBackups;
        const rawBackupIntervalHours = req.body?.backupIntervalHours;
        const rawBackupMode = req.body?.backupMode;
        const rawBackupScheduleDay = req.body?.backupScheduleDay;
        const rawBackupScheduleTime = req.body?.backupScheduleTime;

        const backupsDir = typeof rawBackupsDir === 'string'
            ? String(rawBackupsDir).trim()
            : appConfig.backupsDir;
        const maxBackups = rawMaxBackups === undefined
            ? appConfig.maxBackups
            : Number(rawMaxBackups);
        const backupIntervalHours = rawBackupIntervalHours === undefined
            ? appConfig.backupIntervalHours
            : Number(rawBackupIntervalHours);
        const backupMode = rawBackupMode === undefined
            ? normalizeBackupMode(appConfig.backupMode)
            : normalizeBackupMode(rawBackupMode);
        const backupScheduleDay = rawBackupScheduleDay === undefined
            ? normalizeScheduleDay(appConfig.backupScheduleDay)
            : normalizeScheduleDay(rawBackupScheduleDay);
        const backupScheduleTime = rawBackupScheduleTime === undefined
            ? normalizeScheduleTime(appConfig.backupScheduleTime)
            : normalizeScheduleTime(rawBackupScheduleTime);

        if (!backupsDir) {
            throw buildError('Informe um caminho válido para os backups.');
        }

        if (!Number.isFinite(maxBackups) || maxBackups < 1 || maxBackups > 100) {
            throw buildError('Máximo de backups deve estar entre 1 e 100.');
        }

        if (!Number.isFinite(backupIntervalHours) || backupIntervalHours < 0.5 || backupIntervalHours > 24) {
            throw buildError('Intervalo de backup deve estar entre 0.5 e 24 horas.');
        }

        if (backupMode === 'automatic') {
            if (backupScheduleDay === null) {
                throw buildError('Selecione um dia válido para o agendamento automático.');
            }

            if (!backupScheduleTime) {
                throw buildError('Selecione um horário válido para o agendamento automático.');
            }
        }

        const ensured = await ensureBackupsDir(backupsDir);
        if (!ensured) {
            throw buildError('Não foi possível acessar ou criar o diretório de backups.');
        }

        appConfig = {
            backupsDir,
            maxBackups,
            backupIntervalHours,
            backupMode,
            backupScheduleDay: backupScheduleDay ?? DEFAULT_CONFIG.backupScheduleDay,
            backupScheduleTime: backupScheduleTime || DEFAULT_CONFIG.backupScheduleTime
        };

        await saveConfig(appConfig);
        applyBackupRuntimeConfig(appConfig);

        res.json({
            message: 'Configuração atualizada com sucesso.',
            config: appConfig
        });
    } catch (error) {
        sendError(res, error);
    }
});

app.get('/api/backups/browse', authenticateToken, async (req, res) => {
    try {
        let dirPath = String(req.query?.path || '').trim();
        
        if (!dirPath) {
            if (process.platform === 'win32') {
                dirPath = path.resolve('C:\\');
            } else {
                dirPath = path.resolve('/home');
            }
        }

        dirPath = path.resolve(dirPath);

        const entries = await fs.readdir(dirPath, { withFileTypes: true });
        const folders = entries
            .filter(entry => entry.isDirectory() && !entry.name.startsWith('.'))
            .map(entry => ({
                name: entry.name,
                path: path.join(dirPath, entry.name)
            }))
            .sort((a, b) => a.name.localeCompare(b.name));

        const parentPath = path.dirname(dirPath);
        const canGoUp = parentPath !== dirPath;

        res.json({
            currentPath: dirPath,
            parentPath: canGoUp ? parentPath : null,
            folders
        });
    } catch (error) {
        sendError(res, buildError('Erro ao navegar pastas: ' + error.message));
    }
});

app.get('/', (req, res) => {
    res.sendFile(path.join(projectRoot, 'index.html'));
});

app.use((error, req, res, next) => {
    sendError(res, error);
});

(async () => {
    try {
        appConfig = await loadConfig();
        applyBackupRuntimeConfig(appConfig);
        await ensureBackupsDir(BACKUPS_DIR);
        await migrateDbCategories();
    } catch (error) {
        console.error('Erro ao carregar configuração:', error.message);
        process.exit(1);
    }

    app.listen(port, host, () => {
        console.log(`API do controle de estoque em http://${host}:${port}`);
        console.log(`📁 Backups salvos em: ${BACKUPS_DIR}`);
        console.log(`⚙️ Modo de backup: ${BACKUP_MODE === 'automatic' ? 'automático' : 'manual'}`);
        if (BACKUP_MODE === 'automatic') {
            console.log(`🗓️ Agendamento: dia ${BACKUP_SCHEDULE_DAY} às ${BACKUP_SCHEDULE_TIME}`);
        }

        startBackupScheduler();
        runScheduledBackupIfNeeded().catch((error) => {
            console.error('✗ Falha ao executar backup agendado na inicialização:', error.message);
        });
        
        process.on('SIGINT', () => {
            if (backupScheduler) {
                clearInterval(backupScheduler);
            }
            process.exit(0);
        });
    });
})();