const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const PDFDocument = require('pdfkit');
const pdfParse = require('pdf-parse');
const multer = require('multer');
const XLSX = require('xlsx');
const { XMLParser } = require('fast-xml-parser');
const path = require('path');
require('dotenv').config();

const { readDb, writeDb } = require('./db');
const { authMiddleware } = require('./auth');

const app = express();
const upload = multer({ storage: multer.memoryStorage() });
const projectRoot = path.join(__dirname, '..', '..');
const PORT = Number(process.env.PORT) || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '8h';
const CORS_ORIGIN = process.env.CORS_ORIGIN || '*';

app.use(helmet());
app.use(cors({ origin: CORS_ORIGIN === '*' ? true : CORS_ORIGIN }));
app.use(express.json({ limit: '2mb' }));
app.use(morgan('dev'));
app.use(express.static(projectRoot));

app.get('/', (_req, res) => {
  res.sendFile(path.join(projectRoot, 'index.html'));
});

app.get('/favicon.ico', (_req, res) => {
  res.status(204).end();
});

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function isStrongPassword(password) {
  return (
    typeof password === 'string' &&
    password.length >= 8 &&
    /[A-Z]/.test(password) &&
    /[a-z]/.test(password) &&
    /\d/.test(password) &&
    /[^\w\s]/.test(password)
  );
}

function sanitizeProduct(input) {
  const nome = String(input.nome || '').trim();
  const categoria = String(input.categoria || 'Outros').trim() || 'Outros';
  const quantidade = Number(input.quantidade);
  const preco = Number(input.preco);
  const descricao = String(input.descricao || '').trim();

  if (!nome) throw new Error('Nome do produto é obrigatório.');
  if (!Number.isFinite(quantidade) || quantidade < 0) {
    throw new Error('Quantidade inválida.');
  }
  if (!Number.isFinite(preco) || preco < 0) {
    throw new Error('Preço inválido.');
  }

  const now = new Date().toLocaleDateString('pt-BR');

  return {
    nome,
    categoria,
    quantidade,
    preco,
    descricao,
    dataCriacao: input.dataCriacao || now,
    dataAtualizacao: now
  };
}

async function ensureAdminUser() {
  const db = await readDb();
  const adminEmail = 'admin@estoque.com';

  if (db.users.some((u) => u.email === adminEmail)) return;

  const passwordHash = await bcrypt.hash('admin123', 12);
  db.users.push({
    id: Date.now(),
    name: 'Administrador',
    email: adminEmail,
    passwordHash,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  });

  await writeDb(db);
  console.log('Usuario admin criado: admin@estoque.com / admin123');
}

app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    message: 'Backend do Controle de Estoque ativo.'
  });
});

app.post('/api/auth/register', async (req, res) => {
  try {
    const name = String(req.body.name || '').trim();
    const email = normalizeEmail(req.body.email);
    const password = req.body.password;

    if (!name || !isValidEmail(email)) {
      return res.status(400).json({ error: 'Nome e e-mail válidos são obrigatórios.' });
    }

    if (!isStrongPassword(password)) {
      return res.status(400).json({
        error: 'Senha fraca. Use no mínimo 8 caracteres com maiúscula, minúscula, número e símbolo.'
      });
    }

    const db = await readDb();
    if (db.users.some((u) => u.email === email)) {
      return res.status(409).json({ error: 'E-mail já cadastrado.' });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const user = {
      id: Date.now(),
      name,
      email,
      passwordHash,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    db.users.push(user);
    await writeDb(db);

    return res.status(201).json({
      message: 'Usuário criado com sucesso.',
      user: { id: user.id, name: user.name, email: user.email }
    });
  } catch {
    return res.status(500).json({ error: 'Erro interno ao registrar usuário.' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const email = normalizeEmail(req.body.email);
    const password = req.body.password;

    if (!isValidEmail(email) || !password) {
      return res.status(400).json({ error: 'Credenciais inválidas.' });
    }

    const db = await readDb();
    const user = db.users.find((u) => u.email === email);

    if (!user) {
      return res.status(401).json({ error: 'E-mail ou senha incorretos.' });
    }

    const isValid = await bcrypt.compare(password, user.passwordHash);
    if (!isValid) {
      return res.status(401).json({ error: 'E-mail ou senha incorretos.' });
    }

    const token = jwt.sign(
      { sub: user.id, email: user.email, name: user.name },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    );

    return res.json({
      token,
      user: { id: user.id, name: user.name, email: user.email }
    });
  } catch {
    return res.status(500).json({ error: 'Erro interno ao autenticar.' });
  }
});

app.post('/api/auth/recover', async (req, res) => {
  try {
    const email = normalizeEmail(req.body.email);
    const newPassword = req.body.newPassword;

    if (!isValidEmail(email)) {
      return res.status(400).json({ error: 'E-mail inválido.' });
    }

    if (!isStrongPassword(newPassword)) {
      return res.status(400).json({
        error: 'Senha fraca. Use no mínimo 8 caracteres com maiúscula, minúscula, número e símbolo.'
      });
    }

    const db = await readDb();
    const user = db.users.find((u) => u.email === email);

    if (!user) {
      return res.status(404).json({ error: 'Usuário não encontrado.' });
    }

    user.passwordHash = await bcrypt.hash(newPassword, 12);
    user.updatedAt = new Date().toISOString();
    await writeDb(db);

    return res.json({ message: 'Senha alterada com sucesso.' });
  } catch {
    return res.status(500).json({ error: 'Erro interno ao recuperar senha.' });
  }
});

app.get('/api/products', authMiddleware, async (req, res) => {
  const db = await readDb();
  const products = db.products.filter((p) => p.userId === req.user.sub);
  res.json(products);
});

app.post('/api/products', authMiddleware, async (req, res) => {
  try {
    const db = await readDb();
    const productData = sanitizeProduct(req.body);

    const product = {
      id: Date.now(),
      userId: req.user.sub,
      ...productData
    };

    db.products.push(product);
    await writeDb(db);

    return res.status(201).json(product);
  } catch (error) {
    return res.status(400).json({ error: error.message || 'Dados inválidos.' });
  }
});

app.put('/api/products/:id', authMiddleware, async (req, res) => {
  try {
    const productId = Number(req.params.id);
    const db = await readDb();

    const product = db.products.find(
      (p) => p.id === productId && p.userId === req.user.sub
    );

    if (!product) {
      return res.status(404).json({ error: 'Produto não encontrado.' });
    }

    const updated = sanitizeProduct({ ...product, ...req.body });
    Object.assign(product, updated);

    await writeDb(db);
    return res.json(product);
  } catch (error) {
    return res.status(400).json({ error: error.message || 'Erro ao atualizar.' });
  }
});

app.delete('/api/products/:id', authMiddleware, async (req, res) => {
  const productId = Number(req.params.id);
  const db = await readDb();

  const index = db.products.findIndex(
    (p) => p.id === productId && p.userId === req.user.sub
  );

  if (index === -1) {
    return res.status(404).json({ error: 'Produto não encontrado.' });
  }

  db.products.splice(index, 1);
  await writeDb(db);

  return res.json({ message: 'Produto removido com sucesso.' });
});

app.post('/api/products/import', authMiddleware, async (req, res) => {
  try {
    const produtos = req.body.products;

    if (!Array.isArray(produtos)) {
      return res.status(400).json({ error: 'Envie um array em products.' });
    }

    const db = await readDb();
    const normalized = produtos.map((item) => ({
      id: Number(item.id) || Date.now() + Math.floor(Math.random() * 100000),
      userId: req.user.sub,
      ...sanitizeProduct(item)
    }));

    db.products = db.products.filter((p) => p.userId !== req.user.sub);
    db.products.push(...normalized);

    await writeDb(db);

    return res.json({
      message: 'Produtos importados com sucesso.',
      total: normalized.length
    });
  } catch (error) {
    return res.status(400).json({ error: error.message || 'Erro ao importar produtos.' });
  }
});

app.post('/api/products/import/xml', authMiddleware, async (req, res) => {
  try {
    const xml = String(req.body.xml || '').trim();
    if (!xml) {
      return res.status(400).json({ error: 'Campo xml é obrigatório.' });
    }

    const parser = new XMLParser({ ignoreAttributes: false });
    const parsed = parser.parse(xml);
    const rawProducts = parsed?.estoque?.produtos?.produto;

    if (!rawProducts) {
      return res.status(400).json({ error: 'XML sem produtos válidos.' });
    }

    const list = Array.isArray(rawProducts) ? rawProducts : [rawProducts];

    const db = await readDb();
    const normalized = list.map((item) => ({
      id: Number(item.id) || Date.now() + Math.floor(Math.random() * 100000),
      userId: req.user.sub,
      ...sanitizeProduct(item)
    }));

    db.products = db.products.filter((p) => p.userId !== req.user.sub);
    db.products.push(...normalized);

    await writeDb(db);

    return res.json({
      message: 'Produtos importados via XML com sucesso.',
      total: normalized.length
    });
  } catch (error) {
    return res.status(400).json({ error: error.message || 'Erro ao importar XML.' });
  }
});

async function parseImportedProductsFile(file) {
  if (!file) {
    throw new Error('Arquivo é obrigatório.');
  }

  const originalName = String(file.originalname || '').toLowerCase();
  const mimeType = String(file.mimetype || '').toLowerCase();

  if (originalName.endsWith('.xlsx') || originalName.endsWith('.xls') || mimeType.includes('spreadsheet')) {
    const workbook = XLSX.read(file.buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];

    if (!sheetName) {
      throw new Error('Arquivo XLSX sem planilhas válidas.');
    }

    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: '' });

    return rows.map((row) => ({
      id: row.ID || row.Id || row.id,
      nome: row.Nome || row.nome || row.Name || row.name,
      categoria: row.Categoria || row.categoria || 'Outros',
      quantidade: row.Quantidade ?? row.quantidade ?? 0,
      preco: row.Preco ?? row.preco ?? 0,
      descricao: row.Descricao || row.Descrição || row.descricao || '',
      dataCriacao: row.DataCriacao || row.DataCriação || row.dataCriacao || '',
      dataAtualizacao: row.DataAtualizacao || row.DataAtualização || row.dataAtualizacao || ''
    }));
  }

  if (originalName.endsWith('.pdf') || mimeType.includes('pdf')) {
    const parsed = await pdfParse(file.buffer);
    const match = parsed.text.match(/ESTOQUE_JSON_BASE64_START([\s\S]*?)ESTOQUE_JSON_BASE64_END/);

    if (!match) {
      throw new Error('PDF sem payload de estoque exportado pelo sistema.');
    }

    const payload = match[1].replace(/\s+/g, '');
    const json = Buffer.from(payload, 'base64').toString('utf8');
    return JSON.parse(json);
  }

  throw new Error('Formato nao suportado. Use XLSX ou PDF.');
}

app.post('/api/products/import/file', authMiddleware, upload.single('file'), async (req, res) => {
  try {
    const produtos = await parseImportedProductsFile(req.file);

    if (!Array.isArray(produtos)) {
      return res.status(400).json({ error: 'Arquivo sem produtos válidos.' });
    }

    const db = await readDb();
    const normalized = produtos.map((item) => ({
      id: Number(item.id) || Date.now() + Math.floor(Math.random() * 100000),
      userId: req.user.sub,
      ...sanitizeProduct(item)
    }));

    db.products = db.products.filter((p) => p.userId !== req.user.sub);
    db.products.push(...normalized);

    await writeDb(db);

    return res.json({
      message: 'Produtos importados com sucesso.',
      total: normalized.length
    });
  } catch (error) {
    return res.status(400).json({ error: error.message || 'Erro ao importar arquivo.' });
  }
});

app.get('/api/products/export/xlsx', authMiddleware, async (req, res) => {
  const db = await readDb();
  const products = db.products.filter((p) => p.userId === req.user.sub);

  const rows = products.map((produto) => ({
    ID: produto.id,
    Nome: produto.nome,
    Categoria: produto.categoria,
    Quantidade: produto.quantidade,
    Preco: Number(produto.preco),
    Descricao: produto.descricao || '',
    DataCriacao: produto.dataCriacao || '',
    DataAtualizacao: produto.dataAtualizacao || ''
  }));

  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.json_to_sheet(rows);
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Estoque');

  const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

  res.setHeader(
    'Content-Type',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  );
  res.setHeader(
    'Content-Disposition',
    `attachment; filename=estoque_${new Date().toISOString().slice(0, 10)}.xlsx`
  );

  return res.send(buffer);
});

app.get('/api/products/export/pdf', authMiddleware, async (req, res) => {
  const db = await readDb();
  const products = db.products.filter((p) => p.userId === req.user.sub);

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename=estoque_${new Date().toISOString().slice(0, 10)}.pdf`
  );

  const doc = new PDFDocument({ margin: 40 });
  doc.pipe(res);

  doc.fontSize(18).text('Relatório de Estoque', { align: 'left' });
  doc.moveDown(0.5);
  doc.fontSize(10).text(`Data de exportação: ${new Date().toLocaleString('pt-BR')}`);
  doc.text(`Total de produtos: ${products.length}`);
  doc.moveDown(1);

  products.forEach((produto, i) => {
    doc
      .fontSize(11)
      .text(`${i + 1}. ${produto.nome}`)
      .fontSize(10)
      .text(`Categoria: ${produto.categoria}`)
      .text(`Quantidade: ${produto.quantidade}`)
      .text(`Preço: R$ ${Number(produto.preco).toFixed(2)}`)
      .text(`Descrição: ${produto.descricao || '-'}`)
      .moveDown(0.8);
  });

  const payload = Buffer.from(JSON.stringify(products), 'utf8').toString('base64');
  doc.moveDown(1);
  doc.fontSize(7).text('ESTOQUE_JSON_BASE64_START');
  doc.text(payload, { width: 500 });
  doc.text('ESTOQUE_JSON_BASE64_END');

  doc.end();
});

app.use((req, res) => {
  res.status(404).json({ error: `Rota nao encontrada: ${req.method} ${req.originalUrl || req.url}` });
});

async function start() {
  await ensureAdminUser();

  app.listen(PORT, () => {
    console.log(`Backend rodando em http://localhost:${PORT}`);
  });
}

start();
