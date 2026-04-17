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
const { readDb, writeDb } = require('./db');

const app = express();
const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || '0.0.0.0';
const projectRoot = path.resolve(__dirname, '../..');
const upload = multer({ storage: multer.memoryStorage() });

const xmlParser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_'
});

const PRODUCT_CATEGORIES = ['Eletrônicos', 'Material de escritório'];

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
        categoria,
        quantidade: Math.trunc(quantidade),
        preco: Number(preco.toFixed(2)),
        descricao
    };
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
    const rows = products.map((product) => ({
        ID: product.id,
        Nome: product.nome,
        Categoria: product.categoria,
        Quantidade: product.quantidade,
        Preco: product.preco,
        Descricao: product.descricao || '',
        DataCriacao: product.dataCriacao || '',
        DataAtualizacao: product.dataAtualizacao || ''
    }));

    const worksheet = XLSX.utils.json_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Produtos');
    return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
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

app.use((error, req, res, next) => {
    sendError(res, error);
});

app.listen(port, host, () => {
    console.log(`API do controle de estoque em http://${host}:${port}`);
});