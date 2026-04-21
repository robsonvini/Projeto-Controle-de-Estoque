const { useEffect, useMemo, useRef, useState } = React;

const PRODUCT_CATEGORIES = ['Eletrônicos', 'Material de escritório', 'Armazenamento', 'Periféricos', 'Suprimentos de Impressão'];
const PRODUCT_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ef4444', '#14b8a6'];
const BACKUP_SCHEDULE_DAYS = [
    { value: '0', label: 'Domingo' },
    { value: '1', label: 'Segunda-feira' },
    { value: '2', label: 'Terça-feira' },
    { value: '3', label: 'Quarta-feira' },
    { value: '4', label: 'Quinta-feira' },
    { value: '5', label: 'Sexta-feira' },
    { value: '6', label: 'Sábado' }
];
const MIN_STOCK_THRESHOLD = 2;
const SESSION_KEY = 'estoqueSession';
const SESSION_30_MIN = 30 * 60 * 1000;
const SESSION_24_HOURS = 24 * 60 * 60 * 1000;

const getCategoryClassName = (category) => String(category || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

const normalizeCategoryKey = (value) => String(value || '')
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

const normalizeCategoryLabel = (category) => {
    const key = normalizeCategoryKey(category);

    if (!key) return 'Não informada';

    if (key === 'eletronicos') return 'Eletrônicos';
    if (key === 'material de escritorio') return 'Material de escritório';
    if (key === 'armazenamento' || key === 'informatica') return 'Armazenamento';
    if (key === 'perifericos') return 'Periféricos';
    if (key === 'suprimentos de impressao' || key === 'toner') return 'Suprimentos de Impressão';

    return String(category || '').trim() || 'Não informada';
};

class ApiClient {
    constructor() {
        this.baseUrl = `${window.location.protocol === 'file:' ? 'http://localhost:3000' : window.location.origin}/api`;
        this.tokenKey = 'estoqueApiToken';
    }

    get token() {
        return localStorage.getItem(this.tokenKey);
    }

    set token(value) {
        if (!value) {
            localStorage.removeItem(this.tokenKey);
            return;
        }
        localStorage.setItem(this.tokenKey, value);
    }

    async request(path, options = {}, requireAuth = false) {
        const headers = { ...(options.headers || {}) };

        if (!(options.body instanceof FormData) && !headers['Content-Type']) {
            headers['Content-Type'] = 'application/json';
        }

        if (requireAuth) {
            if (!this.token) {
                throw new Error('Sessão expirada. Faça login novamente.');
            }
            headers.Authorization = `Bearer ${this.token}`;
        }

        const response = await fetch(`${this.baseUrl}${path}`, {
            ...options,
            headers
        });

        const contentType = response.headers.get('content-type') || '';
        const isJson = contentType.includes('application/json');
        const payload = isJson ? await response.json() : await response.text();

        if (!response.ok) {
            const message = isJson && payload?.error ? payload.error : 'Erro na comunicação com a API.';
            const error = new Error(message);
            error.status = response.status;
            throw error;
        }

        return payload;
    }

    health() {
        return this.request('/health');
    }

    register(data) {
        return this.request('/auth/register', {
            method: 'POST',
            body: JSON.stringify(data)
        });
    }

    login(data) {
        return this.request('/auth/login', {
            method: 'POST',
            body: JSON.stringify(data)
        });
    }

    recover(data) {
        return this.request('/auth/recover', {
            method: 'POST',
            body: JSON.stringify(data)
        });
    }

    getProducts() {
        return this.request('/products', { method: 'GET' }, true);
    }

    createProduct(product) {
        return this.request('/products', {
            method: 'POST',
            body: JSON.stringify(product)
        }, true);
    }

    updateProduct(id, product) {
        return this.request(`/products/${id}`, {
            method: 'PUT',
            body: JSON.stringify(product)
        }, true);
    }

    deleteProduct(id) {
        return this.request(`/products/${id}`, { method: 'DELETE' }, true);
    }

    deleteMovement(id) {
        return this.request(`/movements/${id}`, { method: 'DELETE' }, true);
    }

    importProducts(products) {
        return this.request('/products/import', {
            method: 'POST',
            body: JSON.stringify({ products })
        }, true);
    }

    importXml(xml) {
        return this.request('/products/import/xml', {
            method: 'POST',
            body: JSON.stringify({ xml })
        }, true);
    }

    importFile(file) {
        const formData = new FormData();
        formData.append('file', file);
        return this.request('/products/import/file', {
            method: 'POST',
            body: formData,
            headers: {}
        }, true);
    }
    getMovements(filters = {}) {
        const params = new URLSearchParams();

        if (filters.productId) params.set('productId', String(filters.productId));
        if (filters.type) params.set('type', String(filters.type));
        if (filters.from) params.set('from', String(filters.from));
        if (filters.to) params.set('to', String(filters.to));

        const query = params.toString();
        return this.request(`/movements${query ? `?${query}` : ''}`, { method: 'GET' }, true);
    }

    createMovement(productId, payload) {
        return this.request(`/products/${productId}/movements`, {
            method: 'POST',
            body: JSON.stringify(payload)
        }, true);
    }

    getBackups() {
        return this.request('/backups', { method: 'GET' }, true);
    }

    getBackupConfig() {
        return this.request('/backups/config', { method: 'GET' }, true);
    }

    updateBackupConfig(config) {
        return this.request('/backups/config', {
            method: 'PUT',
            body: JSON.stringify(config)
        }, true);
    }

    createBackup() {
        return this.request('/backups/create-now', {
            method: 'POST',
            body: JSON.stringify({})
        }, true);
    }

    async exportBackup() {
        if (!this.token) {
            throw new Error('Sessão expirada. Faça login novamente.');
        }

        const response = await fetch(`${this.baseUrl}/backups/export`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${this.token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({})
        });

        if (!response.ok) {
            const contentType = response.headers.get('content-type') || '';
            const body = contentType.includes('application/json') ? await response.json() : null;
            throw new Error(body?.error || 'Erro ao exportar backup.');
        }

        const blob = await response.blob();
        const contentDisposition = response.headers.get('content-disposition') || '';
        const match = contentDisposition.match(/filename="?([^";]+)"?/i);
        const filename = match?.[1] || `backup-manual-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;

        return { blob, filename };
    }

    restoreBackup(filename) {
        return this.request('/backups/restore', {
            method: 'POST',
            body: JSON.stringify({ filename })
        }, true);
    }

    async download(path, filename) {
        if (!this.token) {
            throw new Error('Sessão expirada. Faça login novamente.');
        }

        const response = await fetch(`${this.baseUrl}${path}`, {
            headers: {
                Authorization: `Bearer ${this.token}`
            }
        });

        if (!response.ok) {
            const contentType = response.headers.get('content-type') || '';
            const body = contentType.includes('application/json') ? await response.json() : null;
            throw new Error(body?.error || 'Falha ao baixar arquivo.');
        }

        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        link.click();
        URL.revokeObjectURL(url);
    }
}

function formatCurrency(value) {
    return new Intl.NumberFormat('pt-BR', {
        style: 'currency',
        currency: 'BRL'
    }).format(Number(value) || 0);
}

function formatDate(value) {
    if (!value) return '-';
    const parsed = parseDate(value);
    if (!parsed) return String(value);
    return new Intl.DateTimeFormat('pt-BR', {
        weekday: 'short',
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    }).format(parsed).replace(/\./g, '');
}

function parseDate(raw) {
    if (!raw) return null;

    if (raw instanceof Date) return raw;

    if (typeof raw === 'string') {
        if (/^\d{4}-\d{2}-\d{2}/.test(raw)) {
            const iso = new Date(raw);
            return Number.isNaN(iso.getTime()) ? null : iso;
        }

        const brMatch = raw.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
        if (brMatch) {
            const [, dayText, monthText, yearText] = brMatch;
            const parsed = new Date(Number(yearText), Number(monthText) - 1, Number(dayText));
            return Number.isNaN(parsed.getTime()) ? null : parsed;
        }

        const fallback = new Date(raw);
        return Number.isNaN(fallback.getTime()) ? null : fallback;
    }

    return null;
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

function capitalizeFirstLetter(text) {
    const value = String(text || '');
    if (!value) return value;
    return value.charAt(0).toUpperCase() + value.slice(1);
}

function getUserInitial(nameOrEmail) {
    const value = String(nameOrEmail || '').trim();
    if (!value) return 'U';
    return value.charAt(0).toUpperCase();
}

const DEFAULT_PROFILE_PHOTO_CONFIG = {
    src: '',
    zoom: 1,
    offsetX: 0,
    offsetY: 0
};

const PROFILE_PHOTO_MAX_SIZE_BYTES = 4 * 1024 * 1024;

function parseProfilePhotoConfig(rawValue) {
    const raw = String(rawValue || '').trim();
    if (!raw) return { ...DEFAULT_PROFILE_PHOTO_CONFIG };

    if (raw.startsWith('{')) {
        try {
            const parsed = JSON.parse(raw);
            return {
                src: String(parsed?.src || ''),
                zoom: Number(parsed?.zoom) >= 1 ? Math.min(2.5, Number(parsed.zoom)) : 1,
                offsetX: Number.isFinite(Number(parsed?.offsetX)) ? Math.max(-35, Math.min(35, Number(parsed.offsetX))) : 0,
                offsetY: Number.isFinite(Number(parsed?.offsetY)) ? Math.max(-35, Math.min(35, Number(parsed.offsetY))) : 0
            };
        } catch {
            return { ...DEFAULT_PROFILE_PHOTO_CONFIG };
        }
    }

    return {
        ...DEFAULT_PROFILE_PHOTO_CONFIG,
        src: raw
    };
}

function getProfilePhotoStyle(config) {
    const current = config || DEFAULT_PROFILE_PHOTO_CONFIG;
    const zoom = Number(current.zoom) >= 1 ? Number(current.zoom) : 1;
    const offsetX = Number.isFinite(Number(current.offsetX)) ? Number(current.offsetX) : 0;
    const offsetY = Number.isFinite(Number(current.offsetY)) ? Number(current.offsetY) : 0;

    return {
        objectPosition: `${50 + offsetX}% ${50 + offsetY}%`,
        transform: `scale(${zoom.toFixed(2)})`,
        transformOrigin: 'center center'
    };
}

function getPeriodDays(period) {
    if (period === 'all') return null;
    const days = Number(period);
    return Number.isFinite(days) ? days : null;
}

function getPasswordStrength(password) {
    let points = 0;
    if (String(password || '').length >= 8) points += 20;
    if (/[A-Z]/.test(password)) points += 20;
    if (/[a-z]/.test(password)) points += 20;
    if (/\d/.test(password)) points += 20;
    if (/[^\w\s]/.test(password)) points += 20;

    if (points <= 40) return { percent: Math.max(8, points), label: 'Fraca' };
    if (points === 60) return { percent: points, label: 'Média' };
    if (points === 80) return { percent: points, label: 'Forte' };
    return { percent: 100, label: 'Muito forte' };
}

function filterByPeriod(products, period) {
    const days = getPeriodDays(period);
    if (!days) return products;

    if (days === 1) {
        const startOfToday = new Date();
        startOfToday.setHours(0, 0, 0, 0);
        const startTimestamp = startOfToday.getTime();

        return products.filter((product) => {
            const date = parseDate(product.dataAtualizacao || product.dataCriacao || product.updatedAt || product.createdAt);
            return date && date.getTime() >= startTimestamp;
        });
    }

    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    return products.filter((product) => {
        const date = parseDate(product.dataAtualizacao || product.dataCriacao || product.updatedAt || product.createdAt);
        return date && date.getTime() >= cutoff;
    });
}

function filterMovementsByPeriod(movements, period) {
    const days = getPeriodDays(period);
    if (!days) return movements;

    if (days === 1) {
        const startOfToday = new Date();
        startOfToday.setHours(0, 0, 0, 0);
        const startTimestamp = startOfToday.getTime();

        return movements.filter((movement) => {
            const date = parseDate(movement.createdAt);
            return date && date.getTime() >= startTimestamp;
        });
    }

    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    return movements.filter((movement) => {
        const date = parseDate(movement.createdAt);
        return date && date.getTime() >= cutoff;
    });
}

function computeMovementFlow(movements) {
    const summary = (Array.isArray(movements) ? movements : []).reduce((acc, movement) => {
        const type = String(movement?.type || '').toLowerCase();
        const quantity = Math.max(0, Number(movement?.quantity) || 0);

        if (type === 'entrada') {
            acc.entryCount += 1;
            acc.entryQuantity += quantity;
            return acc;
        }

        if (type === 'saida') {
            acc.exitCount += 1;
            acc.exitQuantity += quantity;
            return acc;
        }

        return acc;
    }, {
        entryCount: 0,
        exitCount: 0,
        entryQuantity: 0,
        exitQuantity: 0,
        totalMovements: Array.isArray(movements) ? movements.length : 0
    });

    return {
        ...summary,
        netQuantity: summary.entryQuantity - summary.exitQuantity
    };
}

function computeDashboard(products, period) {
    const filtered = filterByPeriod(products, period);
    const totalProdutos = filtered.length;
    const totalItens = filtered.reduce((sum, item) => sum + (Number(item.quantidade) || 0), 0);
    const totalValor = filtered.reduce((sum, item) => sum + ((Number(item.quantidade) || 0) * (Number(item.preco) || 0)), 0);
    const produtosBaixos = filtered.filter((item) => Number(item.quantidade) < MIN_STOCK_THRESHOLD).length;
    const categorias = {};

    filtered.forEach((produto) => {
        const categoria = normalizeCategoryLabel(produto.categoria);
        if (!categoria) {
            return;
        }
        if (!categorias[categoria]) {
            categorias[categoria] = { quantidade: 0, valor: 0, produtos: 0 };
        }

        categorias[categoria].quantidade += Number(produto.quantidade) || 0;
        categorias[categoria].valor += (Number(produto.quantidade) || 0) * (Number(produto.preco) || 0);
        categorias[categoria].produtos += 1;
    });

    return {
        filtered,
        totalProdutos,
        totalItens,
        totalValor,
        produtosBaixos,
        categorias
    };
}

function useNotification() {
    const [notice, setNotice] = useState(null);

    useEffect(() => {
        if (!notice) return undefined;
        const timer = setTimeout(() => setNotice(null), 3000);
        return () => clearTimeout(timer);
    }, [notice]);

    return {
        notice,
        pushNotice: (text, type = 'info') => setNotice({ text, type })
    };
}

function FieldShell({ icon, children }) {
    return (
        <div className="auth-input-shell">
            <span className="auth-field-icon" aria-hidden="true">{icon}</span>
            {children}
        </div>
    );
}

function PasswordField({ id, value, onChange, placeholder, show, onToggle, autoComplete = 'current-password' }) {
    return (
        <div className="password-field">
            <span className="auth-field-icon" aria-hidden="true">🔒</span>
            <input
                type={show ? 'text' : 'password'}
                id={id}
                value={value}
                onChange={onChange}
                placeholder={placeholder}
                autoComplete={autoComplete}
                required
            />
            <button type="button" className="password-toggle" onClick={onToggle} aria-label={show ? 'Ocultar senha' : 'Mostrar senha'}>
                {show ? 'Ocultar' : 'Mostrar'}
            </button>
        </div>
    );
}

function Modal({ title, onClose, children, footer }) {
    return (
        <div className="modal show" role="dialog" aria-modal="true">
            <div className="modal-content">
                <span className="close" onClick={onClose} role="button" aria-label="Fechar">&times;</span>
                {title ? <h2>{title}</h2> : null}
                {children}
                {footer ? <div className="modal-actions">{footer}</div> : null}
            </div>
        </div>
    );
}

const doughnutPercentagePlugin = {
    id: 'doughnutPercentagePlugin',
    afterDatasetsDraw(chart) {
        const dataset = chart.data?.datasets?.[0];
        if (!dataset?.data?.length) return;

        const values = dataset.data.map((value) => Number(value) || 0);
        const total = values.reduce((sum, value) => sum + value, 0);
        if (total <= 0) return;

        const meta = chart.getDatasetMeta(0);
        const { ctx } = chart;

        ctx.save();
        ctx.font = '700 12px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        meta.data.forEach((arc, index) => {
            const value = values[index];
            if (value <= 0) return;

            const percent = (value / total) * 100;
            const { x, y } = arc.tooltipPosition();

            ctx.fillStyle = '#0f172a';
            ctx.fillText(`${percent.toFixed(1)}%`, x, y);
        });

        ctx.restore();
    }
};

const barPercentagePlugin = {
    id: 'barPercentagePlugin',
    afterDatasetsDraw(chart) {
        const dataset = chart.data?.datasets?.[0];
        if (!dataset?.data?.length) return;

        const values = dataset.data.map((value) => Number(value) || 0);
        const total = values.reduce((sum, value) => sum + value, 0);
        if (total <= 0) return;

        const meta = chart.getDatasetMeta(0);
        const { ctx } = chart;

        ctx.save();
        ctx.font = '700 12px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.fillStyle = '#0f172a';

        meta.data.forEach((bar, index) => {
            const value = values[index];
            if (value <= 0) return;

            const percent = (value / total) * 100;
            const x = bar.x;
            const y = bar.y - 6;

            ctx.fillText(`${percent.toFixed(1)}%`, x, y);
        });

        ctx.restore();
    }
};

const stockLevelValuePlugin = {
    id: 'stockLevelValuePlugin',
    afterDatasetsDraw(chart) {
        const dataset = chart.data?.datasets?.[0];
        if (!dataset?.data?.length) return;

        const meta = chart.getDatasetMeta(0);
        const { ctx } = chart;

        ctx.save();
        ctx.font = '700 12px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.fillStyle = '#0f172a';

        meta.data.forEach((bar, index) => {
            const value = Number(dataset.data[index]) || 0;
            ctx.fillText(String(value), bar.x, bar.y - 6);
        });

        ctx.restore();
    }
};


function DashboardCharts({ visible, data, categoryEntries, totalCategoryQty, totalCategoryValue }) {
    const categoryRef = useRef(null);
    const statusRef = useRef(null);
    const flowRef = useRef(null);
    const levelRef = useRef(null);
    const chartsRef = useRef({ category: null, status: null, flow: null, level: null });

    function buildStockLevelSeries(movements, currentTotalItems) {
        const list = Array.isArray(movements) ? movements : [];
        const monthDelta = new Map();

        list.forEach((movement) => {
            const date = parseDate(movement.createdAt);
            if (!date) return;

            const type = String(movement.type || '').toLowerCase();
            const quantity = Math.max(0, Number(movement.quantity) || 0);
            const delta = type === 'entrada' ? quantity : type === 'saida' ? -quantity : 0;
            const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;

            monthDelta.set(key, (monthDelta.get(key) || 0) + delta);
        });

        if (!monthDelta.size) {
            const now = new Date();
            const fallbackLabel = new Intl.DateTimeFormat('pt-BR', { month: 'short', year: '2-digit' })
                .format(new Date(now.getFullYear(), now.getMonth(), 1))
                .replace(/\./g, '');

            return {
                labels: [capitalizeFirstLetter(fallbackLabel)],
                values: [Math.max(0, Number(currentTotalItems) || 0)]
            };
        }

        const sortedKeys = Array.from(monthDelta.keys()).sort();
        const firstKey = sortedKeys[0];
        const lastKey = sortedKeys[sortedKeys.length - 1];
        const [firstYear, firstMonth] = firstKey.split('-').map(Number);
        const [lastYear, lastMonth] = lastKey.split('-').map(Number);

        const timeline = [];
        const cursor = new Date(firstYear, firstMonth - 1, 1);
        const end = new Date(lastYear, lastMonth - 1, 1);

        while (cursor.getTime() <= end.getTime()) {
            const key = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}`;
            timeline.push({
                key,
                year: cursor.getFullYear(),
                monthIndex: cursor.getMonth(),
                delta: monthDelta.get(key) || 0
            });
            cursor.setMonth(cursor.getMonth() + 1);
        }

        const maxMonths = 8;
        const sliced = timeline.length > maxMonths ? timeline.slice(-maxMonths) : timeline;
        const totalDelta = sliced.reduce((sum, item) => sum + item.delta, 0);
        let level = Math.max(0, (Number(currentTotalItems) || 0) - totalDelta);

        const values = sliced.map((item) => {
            level = Math.max(0, level + item.delta);
            return level;
        });

        const labels = sliced.map((item) => (
            capitalizeFirstLetter(
                new Intl.DateTimeFormat('pt-BR', { month: 'short', year: '2-digit' })
                .format(new Date(item.year, item.monthIndex, 1))
                .replace(/\./g, '')
            )
        ));

        return { labels, values };
    }

    useEffect(() => {
        if (!visible || !window.Chart || !categoryRef.current || !statusRef.current || !flowRef.current || !levelRef.current) return undefined;

        const categoryEntries = Object.entries(data.categorias).sort((a, b) => b[1].quantidade - a[1].quantidade);
        const categoryLabels = categoryEntries.length ? categoryEntries.map(([name]) => name) : ['Sem dados'];
        const categoryValues = categoryEntries.length ? categoryEntries.map(([, info]) => info.quantidade) : [1];
        const stockValues = [Math.max(data.totalProdutos - data.produtosBaixos, 0), data.produtosBaixos];
        const movementValues = [Math.max(data.fluxo.entryQuantity, 0), Math.max(data.fluxo.exitQuantity, 0)];
        const stockLevelSeries = buildStockLevelSeries(data.movements, data.totalItens);

        if (chartsRef.current.category) chartsRef.current.category.destroy();
        if (chartsRef.current.status) chartsRef.current.status.destroy();
        if (chartsRef.current.flow) chartsRef.current.flow.destroy();
        if (chartsRef.current.level) chartsRef.current.level.destroy();

        chartsRef.current.category = new window.Chart(categoryRef.current.getContext('2d'), {
            type: 'doughnut',
            data: {
                labels: categoryLabels,
                datasets: [{
                    data: categoryValues,
                    backgroundColor: PRODUCT_COLORS,
                    borderWidth: 0
                }]
            },
            plugins: [doughnutPercentagePlugin],
            options: {
                responsive: true,
                maintainAspectRatio: false,
                animation: {
                    duration: 120
                },
                plugins: {
                    legend: {
                        position: 'bottom',
                        align: 'center',
                        labels: {
                            usePointStyle: true,
                            pointStyle: 'circle',
                            boxWidth: 8,
                            boxHeight: 8,
                            padding: 10,
                            font: {
                                size: 11
                            }
                        }
                    },
                    tooltip: {
                        callbacks: {
                            label(context) {
                                const raw = Number(context.raw) || 0;
                                const datasetData = context.dataset?.data || [];
                                const total = datasetData.reduce((sum, value) => sum + (Number(value) || 0), 0);
                                const percent = total > 0 ? (raw / total) * 100 : 0;
                                return `${context.label}: ${raw} (${percent.toFixed(1)}%)`;
                            }
                        }
                    }
                }
            }
        });

        chartsRef.current.status = new window.Chart(statusRef.current.getContext('2d'), {
            type: 'doughnut',
            data: {
                labels: ['Estoque saudável', 'Estoque baixo'],
                datasets: [{
                    data: stockValues,
                    backgroundColor: ['#10b981', '#ef4444'],
                    borderWidth: 0
                }]
            },
            plugins: [doughnutPercentagePlugin],
            options: {
                responsive: true,
                maintainAspectRatio: false,
                animation: {
                    duration: 120
                },
                plugins: {
                    legend: { position: 'bottom' },
                    tooltip: {
                        callbacks: {
                            label(context) {
                                const raw = Number(context.raw) || 0;
                                const datasetData = context.dataset?.data || [];
                                const total = datasetData.reduce((sum, value) => sum + (Number(value) || 0), 0);
                                const percent = total > 0 ? (raw / total) * 100 : 0;
                                return `${context.label}: ${raw} (${percent.toFixed(1)}%)`;
                            }
                        }
                    }
                }
            }
        });

        chartsRef.current.flow = new window.Chart(flowRef.current.getContext('2d'), {
            type: 'bar',
            data: {
                labels: ['Entradas', 'Saídas'],
                datasets: [{
                    label: 'Quantidade movimentada',
                    data: movementValues,
                    backgroundColor: ['#10b981', '#ef4444'],
                    borderRadius: 10,
                    maxBarThickness: 72
                }]
            },
            plugins: [barPercentagePlugin],
            options: {
                responsive: true,
                maintainAspectRatio: false,
                animation: {
                    duration: 120
                },
                layout: {
                    padding: { top: 18, right: 10, left: 8, bottom: 4 }
                },
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        callbacks: {
                            label(context) {
                                const raw = Number(context.raw) || 0;
                                const datasetData = context.dataset?.data || [];
                                const total = datasetData.reduce((sum, value) => sum + (Number(value) || 0), 0);
                                const percent = total > 0 ? (raw / total) * 100 : 0;
                                return `${context.dataset.label}: ${raw} (${percent.toFixed(1)}%)`;
                            }
                        }
                    }
                },
                scales: {
                    y: { beginAtZero: true, ticks: { precision: 0 } }
                }
            }
        });

        chartsRef.current.level = new window.Chart(levelRef.current.getContext('2d'), {
            type: 'bar',
            data: {
                labels: stockLevelSeries.labels,
                datasets: [{
                    label: 'Nível de estoque (quantidade)',
                    data: stockLevelSeries.values,
                    backgroundColor: stockLevelSeries.values.map((_, index, array) => (
                        index === array.length - 1 ? '#1d4ed8' : '#60a5fa'
                    )),
                    borderColor: '#1e3a8a',
                    borderWidth: 1,
                    borderRadius: 8,
                    maxBarThickness: 64,
                    categoryPercentage: 0.72,
                    barPercentage: 0.86
                }]
            },
            plugins: [stockLevelValuePlugin],
            options: {
                responsive: true,
                maintainAspectRatio: false,
                animation: {
                    duration: 120
                },
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        callbacks: {
                            label(context) {
                                return `Quantidade: ${Number(context.raw) || 0}`;
                            }
                        }
                    }
                },
                scales: {
                    x: {
                        grid: { display: false },
                        ticks: {
                            color: '#1e293b',
                            font: { size: 12, weight: '600' },
                            maxRotation: 0,
                            minRotation: 0,
                            callback(value) {
                                return capitalizeFirstLetter(String(this.getLabelForValue(value) || ''));
                            }
                        }
                    },
                    y: {
                        beginAtZero: true,
                        ticks: {
                            precision: 0,
                            color: '#1e293b',
                            font: { size: 12, weight: '600' }
                        },
                        grid: {
                            color: 'rgba(148, 163, 184, 0.35)',
                            borderDash: [4, 4]
                        }
                    }
                }
            }
        });

        return () => {
            if (chartsRef.current.category) chartsRef.current.category.destroy();
            if (chartsRef.current.status) chartsRef.current.status.destroy();
            if (chartsRef.current.flow) chartsRef.current.flow.destroy();
            if (chartsRef.current.level) chartsRef.current.level.destroy();
        };
    }, [visible, data]);

    const monthlyInsights = data.monthlyInsights || {
        monthLabel: '-',
        entryCount: 0,
        exitCount: 0,
        entryQuantity: 0,
        exitQuantity: 0
    };
    const monthlyTotal = Math.max(0, Number(monthlyInsights.entryQuantity || 0) + Number(monthlyInsights.exitQuantity || 0));
    const entryShare = monthlyTotal ? (Number(monthlyInsights.entryQuantity || 0) / monthlyTotal) * 100 : 0;
    const exitShare = monthlyTotal ? (Number(monthlyInsights.exitQuantity || 0) / monthlyTotal) * 100 : 0;
    const monthlyBalance = Number(monthlyInsights.entryQuantity || 0) - Number(monthlyInsights.exitQuantity || 0);
    const monthlyBalanceLabel = monthlyBalance > 0 ? `+${monthlyBalance}` : String(monthlyBalance);

    return (
        <div className="dashboard-grid">
            <div className="chart-card">
                <div className="section-heading compact">
                    <h3>Participação por categoria</h3>
                    <p>Percentual de itens por categoria sobre o total do estoque.</p>
                </div>
                <div className="category-chart-layout">
                    <div className="category-breakdown-inline">
                        <div id="categoryPercentList" className="category-percent-list">
                            {categoryEntries.length === 0 ? (
                                <p className="empty-state">Nenhuma categoria para exibir ainda.</p>
                            ) : (
                                [...categoryEntries]
                                    .sort((a, b) => b[1].quantidade - a[1].quantidade)
                                    .map(([categoria, info]) => {
                                        const qtyPct = ((info.quantidade / totalCategoryQty) * 100).toFixed(1);
                                        const valueShare = ((info.valor / totalCategoryValue) * 100).toFixed(1);
                                        return (
                                            <div className="category-percent-item" key={categoria}>
                                                <header>
                                                    <h4>{categoria}</h4>
                                                    <span>{qtyPct}%</span>
                                                </header>
                                                <div className="progress-track"><div className="progress-fill" style={{ width: `${qtyPct}%` }}></div></div>
                                                <div className="category-meta">
                                                    <span>{info.quantidade} itens</span>
                                                    <span>{valueShare}% do valor</span>
                                                </div>
                                            </div>
                                        );
                                    })
                            )}
                        </div>
                    </div>
                    <div className="category-chart-canvas">
                        <canvas ref={categoryRef} height="260"></canvas>
                    </div>
                </div>
            </div>
            <div className="chart-card">
                <div className="section-heading compact">
                    <h3>Status do estoque</h3>
                    <p>Distribuição percentual entre estoque saudável e estoque baixo.</p>
                </div>
                <canvas ref={statusRef} height="260"></canvas>
            </div>
            <div className="chart-card chart-card-flow">
                <div className="section-heading compact">
                    <h3>Fluxo de movimentações</h3>
                    <p>Volume de entradas e saídas de produtos no período selecionado.</p>
                </div>
                <canvas ref={flowRef} height="260"></canvas>
            </div>
            <div className="chart-card chart-card-stock-level">
                <div className="section-heading compact">
                    <h3>Nível de estoque</h3>
                    <p>Quantidade acumulada por mês com base no histórico de movimentações.</p>
                </div>
                <canvas ref={levelRef} height="320"></canvas>
            </div>
            <div className="chart-card chart-card-monthly-insights">
                <div className="section-heading compact">
                    <h3>Insights do mês</h3>
                    <p>{monthlyInsights.monthLabel}</p>
                </div>
                <div className={`insight-balance ${monthlyBalance >= 0 ? 'positive' : 'negative'}`}>
                    <span>Saldo do mês</span>
                    <strong>{monthlyBalanceLabel}</strong>
                    <small>{monthlyTotal} item(ns) movimentados</small>
                </div>
                <div className="stock-level-insights">
                    <div className="stock-level-insight-card entry">
                        <span className="label">▲ Entrada no mês</span>
                        <strong>{monthlyInsights.entryQuantity ?? 0}</strong>
                        <small>{monthlyInsights.entryCount ?? 0} movimentação(ões)</small>
                        <div className="insight-progress" aria-hidden="true">
                            <div className="insight-progress-fill" style={{ width: `${entryShare.toFixed(1)}%` }}></div>
                        </div>
                        <span className="insight-share">{entryShare.toFixed(1)}% do fluxo mensal</span>
                    </div>
                    <div className="stock-level-insight-card exit">
                        <span className="label">▼ Saída no mês</span>
                        <strong>{monthlyInsights.exitQuantity ?? 0}</strong>
                        <small>{monthlyInsights.exitCount ?? 0} movimentação(ões)</small>
                        <div className="insight-progress" aria-hidden="true">
                            <div className="insight-progress-fill" style={{ width: `${exitShare.toFixed(1)}%` }}></div>
                        </div>
                        <span className="insight-share">{exitShare.toFixed(1)}% do fluxo mensal</span>
                    </div>
                </div>
            </div>
        </div>
    );
}

function App() {
    const api = useRef(new ApiClient()).current;
    const fileInputRef = useRef(null);
    const profilePhotoInputRef = useRef(null);
    const exportMenuRef = useRef(null);
    const notificationMenuRef = useRef(null);
    const dashboardReportRef = useRef(null);
    const sessionCheckerRef = useRef(null);
    const apiCheckerRef = useRef(null);
    const lowStockNoticeKeyRef = useRef('');

    const [bootstrapped, setBootstrapped] = useState(false);
    const [apiStatus, setApiStatus] = useState({ kind: 'checking', text: 'Verificando API...' });
    const [authTab, setAuthTab] = useState('login');
    const [authFeedback, setAuthFeedback] = useState({ type: 'info', text: 'Use credenciais válidas para acessar.' });
    const { notice, pushNotice } = useNotification();
    const [session, setSession] = useState(() => {
        try {
            const raw = localStorage.getItem(SESSION_KEY);
            return raw ? JSON.parse(raw) : null;
        } catch {
            return null;
        }
    });
    const [token, setToken] = useState(() => api.token);
    const [products, setProducts] = useState([]);
    const [movements, setMovements] = useState([]);
    const [loadingProducts, setLoadingProducts] = useState(false);
    const [loadingMovements, setLoadingMovements] = useState(false);
    const [exportingKpiPdf, setExportingKpiPdf] = useState(false);
    const [backups, setBackups] = useState([]);
    const [loadingBackups, setLoadingBackups] = useState(false);
    const [savingBackupConfig, setSavingBackupConfig] = useState(false);
    const [backupConfig, setBackupConfig] = useState({
        backupMode: 'manual',
        backupScheduleDay: '1',
        backupScheduleTime: '09:00'
    });
    const [activeView, setActiveView] = useState('inventory');
    const [dashboardPeriod, setDashboardPeriod] = useState('all');
    const [showExportMenu, setShowExportMenu] = useState(false);
    const [showNotificationMenu, setShowNotificationMenu] = useState(false);
    const [readNotificationIds, setReadNotificationIds] = useState([]);
    const [dismissedNotificationIds, setDismissedNotificationIds] = useState([]);
    const [lowStockOnly, setLowStockOnly] = useState(false);
    const [search, setSearch] = useState('');
    const [categoryFilter, setCategoryFilter] = useState('');
    const [sortOption, setSortOption] = useState('name');
    const [productForm, setProductForm] = useState({
        nome: '',
        patrimonio: '',
        categoria: '',
        quantidade: 1,
        preco: '',
        descricao: ''
    });
    const [editForm, setEditForm] = useState({
        nome: '',
        patrimonio: '',
        categoria: 'Eletrônicos',
        quantidade: 1,
        preco: '',
        descricao: ''
    });
    const [editingProduct, setEditingProduct] = useState(null);
    const [detailsProduct, setDetailsProduct] = useState(null);
    const [showPasswords, setShowPasswords] = useState({ login: false, register: false, recovery: false });
    const [loginForm, setLoginForm] = useState({ email: '', password: '', remember: false });
    const [registerForm, setRegisterForm] = useState({ name: '', email: '', password: '', confirmPassword: '' });
    const [recoveryForm, setRecoveryForm] = useState({ email: '', newPassword: '', confirmPassword: '' });
    const [dashboardTick, setDashboardTick] = useState(0);
    const [now, setNow] = useState(() => new Date());
    const [movementForm, setMovementForm] = useState({
        category: '',
        productId: '',
        type: 'entrada',
        quantity: 1,
        reason: ''
    });
    const [movementFilter, setMovementFilter] = useState({ productId: '', category: '', type: '', period: 'all', order: 'recent' });
    const [profilePhotoConfig, setProfilePhotoConfig] = useState(() => ({ ...DEFAULT_PROFILE_PHOTO_CONFIG }));
    const [profilePhotoDraft, setProfilePhotoDraft] = useState(() => ({ ...DEFAULT_PROFILE_PHOTO_CONFIG }));
    const [showProfilePhotoModal, setShowProfilePhotoModal] = useState(false);
    const [productNavIndex, setProductNavIndex] = useState({});
    const [selectedProduct, setSelectedProduct] = useState(null);
    const [expandedCategory, setExpandedCategory] = useState(null);

    const showApp = Boolean(token && session && session.expiraEm && Date.now() < session.expiraEm);
    const activeUserEmail = String(session?.email || '').trim().toLowerCase();
    const profilePhotoStorageKey = activeUserEmail ? `estoqueProfilePhoto:${activeUserEmail}` : '';

    useEffect(() => {
        const checkBackend = async (silent = false) => {
            setApiStatus({ kind: 'checking', text: 'Verificando API...' });
            try {
                await api.health();
                setApiStatus({ kind: 'online', text: 'API online' });
                if (!silent) {
                    setAuthFeedback({ type: 'info', text: 'Backend conectado. Faça login para continuar.' });
                }
            } catch {
                setApiStatus({ kind: 'offline', text: 'API offline' });
                if (!silent) {
                    setAuthFeedback({ type: 'error', text: 'Não foi possível conectar ao backend em http://localhost:3000.' });
                }
            }
        };

        checkBackend(true);
        apiCheckerRef.current = setInterval(() => checkBackend(true), 15000);

        let storedSession = null;
        try {
            const raw = localStorage.getItem(SESSION_KEY);
            storedSession = raw ? JSON.parse(raw) : null;
        } catch {
            storedSession = null;
        }

        if (!api.token || !storedSession || !storedSession.expiraEm || Date.now() > storedSession.expiraEm || !storedSession.remember) {
            api.token = null;
            localStorage.removeItem(SESSION_KEY);
            setSession(null);
            setToken(null);
        } else {
            setSession(storedSession);
            setToken(api.token);
        }

        setBootstrapped(true);

        return () => {
            if (apiCheckerRef.current) clearInterval(apiCheckerRef.current);
        };
    }, [api]);

    useEffect(() => {
        if (!bootstrapped || !token) return undefined;

        const loadProducts = async () => {
            try {
                setLoadingProducts(true);
                const list = await api.getProducts();
                setProducts(list);
            } catch (error) {
                if (error.status === 401) {
                    handleLogout('Sessão expirada. Entre novamente.');
                    return;
                }
                pushNotice(error.message || 'Erro ao carregar produtos.', 'error');
            } finally {
                setLoadingProducts(false);
            }
        };

        loadProducts();
    }, [bootstrapped, token, dashboardTick]);

    useEffect(() => {
        if (!bootstrapped || !token) return undefined;

        const loadMovements = async () => {
            try {
                setLoadingMovements(true);
                const list = await api.getMovements();
                setMovements(list);
            } catch (error) {
                if (error.status === 401) {
                    handleLogout('Sessão expirada. Entre novamente.');
                    return;
                }
                pushNotice(error.message || 'Erro ao carregar movimentações.', 'error');
            } finally {
                setLoadingMovements(false);
            }
        };

        loadMovements();
    }, [bootstrapped, token]);

    useEffect(() => {
        if (!bootstrapped || !token) return undefined;

        const loadBackupsData = async () => {
            try {
                setLoadingBackups(true);
                const [result, config] = await Promise.all([
                    api.getBackups(),
                    api.getBackupConfig()
                ]);
                setBackups(result.backups || []);
                setBackupConfig((current) => ({
                    ...current,
                    backupMode: String(config?.backupMode || 'manual'),
                    backupScheduleDay: String(config?.backupScheduleDay ?? '1'),
                    backupScheduleTime: String(config?.backupScheduleTime || '09:00')
                }));
            } catch (error) {
                if (error.status !== 401) {
                    console.error('Erro ao carregar backups:', error.message);
                }
            } finally {
                setLoadingBackups(false);
            }
        };

        loadBackupsData();
    }, [bootstrapped, token]);

    useEffect(() => {
        const timer = setInterval(() => {
            const raw = localStorage.getItem(SESSION_KEY);
            if (!raw) return;

            try {
                const current = JSON.parse(raw);
                if (current.expiraEm && Date.now() > current.expiraEm) {
                    handleLogout('Sessão expirada. Entre novamente.');
                }
            } catch {
                handleLogout('Sessão inválida. Entre novamente.');
            }
        }, 60000);

        sessionCheckerRef.current = timer;
        return () => clearInterval(timer);
    }, [token]);

    useEffect(() => {
        const timer = setInterval(() => {
            setNow(new Date());
        }, 1000);

        return () => clearInterval(timer);
    }, []);

    useEffect(() => {
        if (!showApp || !profilePhotoStorageKey) {
            setProfilePhotoConfig({ ...DEFAULT_PROFILE_PHOTO_CONFIG });
            setProfilePhotoDraft({ ...DEFAULT_PROFILE_PHOTO_CONFIG });
            return;
        }

        try {
            const saved = localStorage.getItem(profilePhotoStorageKey) || '';
            const parsed = parseProfilePhotoConfig(saved);
            setProfilePhotoConfig(parsed);
            setProfilePhotoDraft(parsed);
        } catch {
            setProfilePhotoConfig({ ...DEFAULT_PROFILE_PHOTO_CONFIG });
            setProfilePhotoDraft({ ...DEFAULT_PROFILE_PHOTO_CONFIG });
        }
    }, [showApp, profilePhotoStorageKey]);

    useEffect(() => {
        const handleOutsideClick = (event) => {
            if (exportMenuRef.current && !exportMenuRef.current.contains(event.target)) {
                setShowExportMenu(false);
            }

            if (notificationMenuRef.current && !notificationMenuRef.current.contains(event.target)) {
                setShowNotificationMenu(false);
            }
        };

        document.addEventListener('click', handleOutsideClick);
        return () => document.removeEventListener('click', handleOutsideClick);
    }, []);

    useEffect(() => {
        if (showApp) return;
        setShowNotificationMenu(false);
        setReadNotificationIds([]);
        setDismissedNotificationIds([]);
    }, [showApp]);

    useEffect(() => {
        if (editingProduct) {
            setEditForm({
                nome: editingProduct.nome || '',
                patrimonio: editingProduct.patrimonio || '',
                categoria: normalizeCategoryLabel(editingProduct.categoria) || 'Eletrônicos',
                quantidade: editingProduct.quantidade || 1,
                preco: editingProduct.preco ?? '',
                descricao: editingProduct.descricao || ''
            });
        }
    }, [editingProduct]);

    useEffect(() => {
        setDashboardTick((value) => value);
    }, [activeView, dashboardPeriod, products]);

    useEffect(() => {
        if (!products.length) {
            setMovementForm((current) => ({ ...current, category: '', productId: '' }));
            return;
        }

        setMovementForm((current) => {
            const currentProduct = products.find((item) => String(item.id) === String(current.productId));

            if (currentProduct) {
                const normalizedCategory = normalizeCategoryLabel(currentProduct.categoria);
                if (current.category === normalizedCategory) {
                    return current;
                }

                return {
                    ...current,
                    category: normalizedCategory
                };
            }

            return current;
        });
    }, [products]);

    const filteredProducts = useMemo(() => {
        let list = [...products];
        const query = search.trim().toLowerCase();

        if (query) {
            list = list.filter((product) => (
                product.nome?.toLowerCase().includes(query) ||
                String(product.patrimonio || '').toLowerCase().includes(query) ||
                (product.descricao || '').toLowerCase().includes(query) ||
                product.categoria?.toLowerCase().includes(query)
            ));
        }

        if (categoryFilter) {
            list = list.filter((product) => normalizeCategoryLabel(product.categoria) === categoryFilter);
        }

        if (lowStockOnly) {
            list = list.filter((product) => (Number(product.quantidade) || 0) < MIN_STOCK_THRESHOLD);
        }

        switch (sortOption) {
            case 'name':
                list.sort((a, b) => String(a.nome || '').localeCompare(String(b.nome || ''), 'pt-BR'));
                break;
            case 'quantity':
                list.sort((a, b) => (Number(a.quantidade) || 0) - (Number(b.quantidade) || 0));
                break;
            case 'price':
                list.sort((a, b) => (Number(a.preco) || 0) - (Number(b.preco) || 0));
                break;
            case 'category':
                list.sort((a, b) => String(a.categoria || '').localeCompare(String(b.categoria || ''), 'pt-BR'));
                break;
            default:
                break;
        }

        return list;
    }, [products, search, categoryFilter, sortOption, lowStockOnly]);

    const groupedInventoryCards = useMemo(() => {
        const groups = new Map();

        filteredProducts.forEach((product) => {
            const categoria = normalizeCategoryLabel(product.categoria);
            const key = categoria;

            if (!groups.has(key)) {
                groups.set(key, {
                    key,
                    nome: categoria,
                    items: [],
                    totalQuantidade: 0,
                    totalValor: 0,
                    hasLowStock: false,
                    categorias: new Set([categoria])
                });
            }

            const group = groups.get(key);
            const quantidade = Number(product.quantidade) || 0;
            const preco = Number(product.preco) || 0;

            group.items.push(product);
            group.totalQuantidade += quantidade;
            group.totalValor += quantidade * preco;
            group.hasLowStock = group.hasLowStock || quantidade < MIN_STOCK_THRESHOLD;
        });

        const cards = Array.from(groups.values()).map((group) => {
            const categorias = Array.from(group.categorias);
            const categoriaPrincipal = categorias[0] || 'Não informada';

            const sortedItems = [...group.items].sort((a, b) => {
                const patrimonioA = String(a.patrimonio || '').toLocaleLowerCase('pt-BR');
                const patrimonioB = String(b.patrimonio || '').toLocaleLowerCase('pt-BR');
                return patrimonioA.localeCompare(patrimonioB, 'pt-BR');
            });

            return {
                ...group,
                categoriaPrincipal,
                categorias,
                items: sortedItems
            };
        });

        cards.sort((a, b) => {
            if (sortOption === 'quantity') {
                return a.totalQuantidade - b.totalQuantidade;
            }

            if (sortOption === 'price') {
                return a.totalValor - b.totalValor;
            }

            if (sortOption === 'category') {
                return String(a.categoriaPrincipal || '').localeCompare(String(b.categoriaPrincipal || ''), 'pt-BR');
            }

            return String(a.nome || '').localeCompare(String(b.nome || ''), 'pt-BR');
        });

        return cards;
    }, [filteredProducts, sortOption]);

    const lowStockProducts = useMemo(
        () => products.filter((item) => (Number(item.quantidade) || 0) < MIN_STOCK_THRESHOLD),
        [products]
    );

    const movementCategoryByProductId = useMemo(
        () => new Map(products.map((item) => [String(item.id), normalizeCategoryLabel(item.categoria)])),
        [products]
    );

    const movementPatrimonyByProductId = useMemo(
        () => new Map(products.map((item) => [String(item.id), item.patrimonio || '-'])),
        [products]
    );

    const movementDescriptionByProductId = useMemo(
        () => new Map(products.map((item) => [String(item.id), item.descricao || '-'])),
        [products]
    );

    const productById = useMemo(
        () => new Map(products.map((item) => [String(item.id), item])),
        [products]
    );

    const headerNotifications = useMemo(() => {
        const lowStockNotifications = lowStockProducts.map((product) => {
            const quantity = Number(product.quantidade) || 0;
            const timestampDate = parseDate(product.dataAtualizacao || product.updatedAt || product.createdAt || product.dataCriacao);

            return {
                id: `low-stock-${product.id}-${quantity}`,
                type: 'warning',
                title: 'Estoque baixo',
                message: `${product.nome} está com ${quantity} unidade(s) em estoque.`,
                meta: `${normalizeCategoryLabel(product.categoria)}${product.patrimonio ? ` · Patrimônio ${product.patrimonio}` : ''}`,
                timestamp: timestampDate ? timestampDate.getTime() : 0,
                timeLabel: timestampDate ? formatDate(timestampDate) : 'Sem data'
            };
        });

        const exitNotifications = movements
            .filter((movement) => String(movement.type || '').toLowerCase() === 'saida')
            .map((movement, index) => {
                const quantity = Number(movement.quantity) || 0;
                const timestampDate = parseDate(movement.createdAt);
                const fallbackProduct = productById.get(String(movement.productId));
                const productName = movement.productName || fallbackProduct?.nome || 'Produto';
                const previousStock = Number.isFinite(Number(movement.previousStock)) ? Number(movement.previousStock) : '-';
                const newStock = Number.isFinite(Number(movement.newStock)) ? Number(movement.newStock) : '-';

                return {
                    id: `exit-${movement.id || `${movement.productId}-${movement.createdAt || index}-${quantity}`}`,
                    type: 'info',
                    title: 'Saída de estoque',
                    message: `${productName}: saída de ${quantity} unidade(s).`,
                    meta: `Saldo: ${previousStock} -> ${newStock}${movement.reason ? ` · ${movement.reason}` : ''}`,
                    timestamp: timestampDate ? timestampDate.getTime() : 0,
                    timeLabel: timestampDate ? formatDate(timestampDate) : 'Sem data'
                };
            })
            .slice(0, 20);

        const entryNotifications = movements
            .filter((movement) => String(movement.type || '').toLowerCase() === 'entrada')
            .map((movement, index) => {
                const quantity = Number(movement.quantity) || 0;
                const timestampDate = parseDate(movement.createdAt);
                const fallbackProduct = productById.get(String(movement.productId));
                const productName = movement.productName || fallbackProduct?.nome || 'Produto';
                const previousStock = Number.isFinite(Number(movement.previousStock)) ? Number(movement.previousStock) : '-';
                const newStock = Number.isFinite(Number(movement.newStock)) ? Number(movement.newStock) : '-';

                return {
                    id: `entry-${movement.id || `${movement.productId}-${movement.createdAt || index}-${quantity}`}`,
                    type: 'success',
                    title: 'Entrada de estoque',
                    message: `${productName}: entrada de ${quantity} unidade(s).`,
                    meta: `Saldo: ${previousStock} -> ${newStock}${movement.reason ? ` · ${movement.reason}` : ''}`,
                    timestamp: timestampDate ? timestampDate.getTime() : 0,
                    timeLabel: timestampDate ? formatDate(timestampDate) : 'Sem data'
                };
            })
            .slice(0, 20);

        return [...lowStockNotifications, ...exitNotifications, ...entryNotifications]
            .sort((a, b) => b.timestamp - a.timestamp)
            .slice(0, 30);
    }, [lowStockProducts, movements, productById]);

    const dismissedNotificationIdSet = useMemo(
        () => new Set(dismissedNotificationIds),
        [dismissedNotificationIds]
    );

    const visibleHeaderNotifications = useMemo(
        () => headerNotifications.filter((item) => !dismissedNotificationIdSet.has(item.id)),
        [headerNotifications, dismissedNotificationIdSet]
    );

    const readNotificationIdSet = useMemo(
        () => new Set(readNotificationIds),
        [readNotificationIds]
    );

    const unreadNotificationCount = useMemo(
        () => visibleHeaderNotifications.filter((item) => !readNotificationIdSet.has(item.id)).length,
        [visibleHeaderNotifications, readNotificationIdSet]
    );

    useEffect(() => {
        const ids = new Set(headerNotifications.map((item) => item.id));
        setReadNotificationIds((current) => current.filter((id) => ids.has(id)));
        setDismissedNotificationIds((current) => current.filter((id) => ids.has(id)));
    }, [headerNotifications]);

    function markAllNotificationsAsRead() {
        if (!visibleHeaderNotifications.length) return;
        setReadNotificationIds((current) => {
            const merged = new Set(current);
            visibleHeaderNotifications.forEach((item) => merged.add(item.id));
            return Array.from(merged);
        });
    }

    function clearNotifications() {
        if (!visibleHeaderNotifications.length) return;

        setDismissedNotificationIds((current) => {
            const merged = new Set(current);
            visibleHeaderNotifications.forEach((item) => merged.add(item.id));
            return Array.from(merged);
        });

        setReadNotificationIds((current) => {
            const merged = new Set(current);
            visibleHeaderNotifications.forEach((item) => merged.add(item.id));
            return Array.from(merged);
        });
    }

    function handleToggleNotificationMenu() {
        setShowNotificationMenu((current) => {
            const next = !current;
            if (next) {
                markAllNotificationsAsRead();
            }
            return next;
        });
    }

    const filteredMovements = useMemo(() => {
        let list = [...movements];

        if (movementFilter.productId) {
            list = list.filter((item) => String(item.productId) === String(movementFilter.productId));
        }

        if (movementFilter.category) {
            list = list.filter((item) => {
                const category = movementCategoryByProductId.get(String(item.productId));
                return category === movementFilter.category;
            });
        }

        if (movementFilter.type) {
            list = list.filter((item) => item.type === movementFilter.type);
        }

        if (movementFilter.period && movementFilter.period !== 'all') {
            const days = Number(movementFilter.period);
            if (Number.isFinite(days) && days > 0) {
                const startOfToday = new Date();
                startOfToday.setHours(0, 0, 0, 0);

                const rangeStart = new Date(startOfToday);
                rangeStart.setDate(startOfToday.getDate() - (days - 1));

                const rangeEnd = new Date(startOfToday);
                rangeEnd.setHours(23, 59, 59, 999);

                list = list.filter((item) => {
                    const date = parseDate(item.createdAt);
                    if (!date) return false;
                    return date.getTime() >= rangeStart.getTime() && date.getTime() <= rangeEnd.getTime();
                });
            }
        }

        list.sort((a, b) => {
            const dateA = parseDate(a.createdAt);
            const dateB = parseDate(b.createdAt);
            const timeA = dateA ? dateA.getTime() : 0;
            const timeB = dateB ? dateB.getTime() : 0;

            if (movementFilter.order === 'oldest') {
                return timeA - timeB;
            }

            return timeB - timeA;
        });

        return list;
    }, [movements, movementFilter, movementCategoryByProductId]);

    const movementSummary = useMemo(() => {
        const total = filteredMovements.length;
        const entries = filteredMovements.filter((item) => item.type === 'entrada').length;
        const exits = filteredMovements.filter((item) => item.type === 'saida').length;
        const today = new Date().toDateString();
        const todayCount = filteredMovements.filter((item) => {
            const date = parseDate(item.createdAt);
            return date && date.toDateString() === today;
        }).length;

        return { total, entries, exits, todayCount };
    }, [filteredMovements]);

    const selectedMovementProduct = useMemo(
        () => products.find((item) => String(item.id) === String(movementForm.productId)) || null,
        [products, movementForm.productId]
    );

    const movementProductsByCategory = useMemo(() => {
        if (!movementForm.category) {
            return [];
        }

        return products.filter((item) => normalizeCategoryLabel(item.categoria) === movementForm.category);
    }, [products, movementForm.category]);

    const movementFilterProductsByCategory = useMemo(() => {
        if (!movementFilter.category) {
            return products;
        }

        return products.filter((item) => normalizeCategoryLabel(item.categoria) === movementFilter.category);
    }, [products, movementFilter.category]);

    useEffect(() => {
        if (!movementProductsByCategory.length) {
            if (!movementForm.productId) {
                return;
            }

            setMovementForm((current) => ({ ...current, productId: '' }));
            return;
        }

        if (!movementForm.productId) {
            const firstId = String(movementProductsByCategory[0].id);
            setMovementForm((current) => (current.productId === firstId ? current : { ...current, productId: firstId }));
            return;
        }

        const existsInCategory = movementProductsByCategory.some(
            (item) => String(item.id) === String(movementForm.productId)
        );

        if (!existsInCategory) {
            const firstId = String(movementProductsByCategory[0].id);
            setMovementForm((current) => (current.productId === firstId ? current : { ...current, productId: firstId }));
        }
    }, [movementProductsByCategory, movementForm.productId]);

    useEffect(() => {
        if (!movementFilter.productId) {
            return;
        }

        const existsInCategory = movementFilterProductsByCategory.some(
            (item) => String(item.id) === String(movementFilter.productId)
        );

        if (!existsInCategory) {
            setMovementFilter((current) => ({ ...current, productId: '' }));
        }
    }, [movementFilterProductsByCategory, movementFilter.productId]);

    const movementPeriodLabel = useMemo(() => {
        if (!movementFilter.period || movementFilter.period === 'all') {
            return 'Intervalo aplicado: todo o histórico';
        }

        const days = Number(movementFilter.period);
        if (!Number.isFinite(days) || days < 1) {
            return 'Intervalo aplicado: todo o histórico';
        }

        const startOfToday = new Date();
        startOfToday.setHours(0, 0, 0, 0);

        const rangeStart = new Date(startOfToday);
        rangeStart.setDate(startOfToday.getDate() - (days - 1));

        const rangeEnd = new Date(startOfToday);
        rangeEnd.setHours(23, 59, 59, 999);

        return `Intervalo aplicado: ${rangeStart.toLocaleDateString('pt-BR')} até ${rangeEnd.toLocaleDateString('pt-BR')}`;
    }, [movementFilter.period]);

    useEffect(() => {
        if (!showApp) return;
        if (!lowStockProducts.length) {
            lowStockNoticeKeyRef.current = '';
            return;
        }

        const key = lowStockProducts
            .map((item) => `${item.id}:${item.quantidade}`)
            .sort()
            .join('|');

        if (lowStockNoticeKeyRef.current === key) return;
        lowStockNoticeKeyRef.current = key;

        notify(
            `Alerta: ${lowStockProducts.length} produto(s) com estoque abaixo de ${MIN_STOCK_THRESHOLD}.`,
            'warning'
        );
    }, [showApp, lowStockProducts]);

    const dashboardData = useMemo(() => computeDashboard(products, dashboardPeriod), [products, dashboardPeriod]);
    const dashboardMovements = useMemo(() => filterMovementsByPeriod(movements, dashboardPeriod), [movements, dashboardPeriod]);
    const dashboardFlow = useMemo(() => computeMovementFlow(dashboardMovements), [dashboardMovements]);
    const monthlyStockInsights = useMemo(() => {
        const nowDate = new Date();
        const month = nowDate.getMonth();
        const year = nowDate.getFullYear();

        const summary = (Array.isArray(movements) ? movements : []).reduce((acc, movement) => {
            const date = parseDate(movement.createdAt);
            if (!date || date.getMonth() !== month || date.getFullYear() !== year) {
                return acc;
            }

            const type = String(movement.type || '').toLowerCase();
            const quantity = Math.max(0, Number(movement.quantity) || 0);

            if (type === 'entrada') {
                acc.entryCount += 1;
                acc.entryQuantity += quantity;
                return acc;
            }

            if (type === 'saida') {
                acc.exitCount += 1;
                acc.exitQuantity += quantity;
            }

            return acc;
        }, {
            entryCount: 0,
            exitCount: 0,
            entryQuantity: 0,
            exitQuantity: 0
        });

        return {
            ...summary,
            monthLabel: capitalizeFirstLetter(new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric' }).format(nowDate))
        };
    }, [movements]);
    const dashboardChartsData = useMemo(
        () => ({ ...dashboardData, fluxo: dashboardFlow, movements: dashboardMovements, monthlyInsights: monthlyStockInsights }),
        [dashboardData, dashboardFlow, dashboardMovements, monthlyStockInsights]
    );
    const nowLabel = useMemo(() => {
        const label = new Intl.DateTimeFormat('pt-BR', {
            weekday: 'long',
            day: '2-digit',
            month: 'long',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        }).format(now);

        return label.charAt(0).toUpperCase() + label.slice(1);
    }, [now]);
    const categoryEntries = Object.entries(dashboardData.categorias);
    const totalCategoryQty = categoryEntries.reduce((sum, [, item]) => sum + item.quantidade, 0) || 1;
    const totalCategoryValue = categoryEntries.reduce((sum, [, item]) => sum + item.valor, 0) || 1;
    const productsHealthy = dashboardData.totalProdutos - dashboardData.produtosBaixos;
    const lowStockPct = dashboardData.totalProdutos ? (dashboardData.produtosBaixos / dashboardData.totalProdutos) * 100 : 0;
    const healthyPct = dashboardData.totalProdutos ? (productsHealthy / dashboardData.totalProdutos) * 100 : 0;
    const topValueCategory = [...categoryEntries].sort((a, b) => b[1].valor - a[1].valor)[0];
    const topCategory = [...categoryEntries].sort((a, b) => b[1].quantidade - a[1].quantidade)[0];
    const topValuePct = topValueCategory ? (topValueCategory[1].valor / totalCategoryValue) * 100 : 0;
    const periodLabel = dashboardPeriod === 'all'
        ? 'todo o estoque'
        : dashboardPeriod === '1'
            ? 'hoje'
            : `últimos ${dashboardPeriod} dias`;
    const avgValueByProduct = dashboardData.totalProdutos ? dashboardData.totalValor / dashboardData.totalProdutos : 0;
    const avgItemsByProduct = dashboardData.totalProdutos ? dashboardData.totalItens / dashboardData.totalProdutos : 0;
    const concentrationQtyPct = topCategory ? (topCategory[1].quantidade / totalCategoryQty) * 100 : 0;
    const concentrationValuePct = topValueCategory ? (topValueCategory[1].valor / totalCategoryValue) * 100 : 0;
    const flowBalanceLabel = dashboardFlow.netQuantity >= 0 ? `+${dashboardFlow.netQuantity}` : `${dashboardFlow.netQuantity}`;
    const kpiCards = [
        {
            title: 'Saúde do estoque',
            value: `${healthyPct.toFixed(1)}%`,
            subtitle: `${productsHealthy} de ${dashboardData.totalProdutos} produtos sem alerta`,
            progress: healthyPct,
            tone: 'good'
        },
        {
            title: 'Risco de ruptura',
            value: `${lowStockPct.toFixed(1)}%`,
            subtitle: `${dashboardData.produtosBaixos} produto(s) abaixo do mínimo`,
            progress: lowStockPct,
            tone: 'risk'
        },
        {
            title: 'Valor médio por produto',
            value: formatCurrency(avgValueByProduct),
            subtitle: `Base de ${dashboardData.totalProdutos} produto(s) em ${periodLabel}`,
            progress: Math.min(100, (avgValueByProduct / 5000) * 100),
            tone: 'neutral'
        },
        {
            title: 'Itens médios por produto',
            value: avgItemsByProduct.toFixed(1),
            subtitle: `${dashboardData.totalItens} itens distribuídos no período`,
            progress: Math.min(100, (avgItemsByProduct / 50) * 100),
            tone: 'neutral'
        },
        {
            title: 'Concentração (quantidade)',
            value: `${concentrationQtyPct.toFixed(1)}%`,
            subtitle: topCategory ? `${topCategory[0]} concentra mais itens` : 'Sem categoria dominante',
            progress: concentrationQtyPct,
            tone: 'focus'
        },
        {
            title: 'Concentração (valor)',
            value: `${concentrationValuePct.toFixed(1)}%`,
            subtitle: topValueCategory ? `${topValueCategory[0]} lidera em valor` : 'Sem categoria dominante',
            progress: concentrationValuePct,
            tone: 'focus'
        }
    ];

    function notify(text, type = 'info') {
        pushNotice(text, type);
    }

    function handleLogout(message = 'Sessão encerrada.') {
        api.token = null;
        localStorage.removeItem(SESSION_KEY);
        setToken(null);
        setSession(null);
        setProducts([]);
        setMovements([]);
        setActiveView('inventory');
        setShowExportMenu(false);
        setShowNotificationMenu(false);
        setReadNotificationIds([]);
        setDismissedNotificationIds([]);
        setAuthTab('login');
        setAuthFeedback({ type: 'info', text: message });
    }

    async function loadProductsAfterChange() {
        async function loadMovementsAfterChange() {
            try {
                const list = await api.getMovements();
                setMovements(list);
            } catch (error) {
                if (error.status === 401) {
                    handleLogout('Sessão expirada. Entre novamente.');
                    return;
                }
                notify(error.message || 'Não foi possível atualizar as movimentações.', 'error');
            }
        }
        try {
            const list = await api.getProducts();
            setProducts(list);
        } catch (error) {
            if (error.status === 401) {
                handleLogout('Sessão expirada. Entre novamente.');
                return;
            }
            notify(error.message || 'Não foi possível atualizar os produtos.', 'error');
        }
        await loadMovementsAfterChange();
    }

    async function handleLogin(event) {
        event.preventDefault();
        const email = String(loginForm.email || '').trim().toLowerCase();
        const password = loginForm.password;

        if (!email || !password) {
            setAuthFeedback({ type: 'error', text: 'Informe e-mail e senha válidos.' });
            return;
        }

        try {
            const response = await api.login({ email, password });
            api.token = response.token;
            setToken(response.token);

            const now = Date.now();
            const expiraEm = now + (loginForm.remember ? SESSION_24_HOURS : SESSION_30_MIN);
            const nextSession = {
                ...response.user,
                expiraEm,
                remember: Boolean(loginForm.remember)
            };

            if (loginForm.remember) {
                localStorage.setItem(SESSION_KEY, JSON.stringify(nextSession));
            } else {
                localStorage.removeItem(SESSION_KEY);
            }
            setSession(nextSession);
            setLoginForm((current) => ({ ...current, password: '' }));
            setAuthFeedback({ type: 'success', text: 'Login realizado com sucesso.' });
            setActiveView('inventory');
            await loadProductsAfterChange();
            await loadMovementsAfterChange();
        } catch (error) {
            setApiStatus({ kind: 'offline', text: 'API offline' });
            setAuthFeedback({ type: 'error', text: error.message || 'Falha ao autenticar.' });
        }
    }

    async function registerProductMovement(productId, payload, options = {}) {
        const { resetForm = false, successMessage = 'Movimentação registrada com sucesso!' } = options;

        try {
            const result = await api.createMovement(productId, payload);
            setProducts((current) => current.map((item) => (String(item.id) === String(result.product.id) ? result.product : item)));
            setMovements((current) => [result.movement, ...current]);

            if (resetForm) {
                setMovementForm((current) => ({ ...current, quantity: 1, reason: '' }));
            }

            notify(successMessage, 'success');
        } catch (error) {
            if (error.status === 401) {
                handleLogout('Sessão expirada. Entre novamente.');
                return;
            }
            notify(error.message || 'Não foi possível registrar a movimentação.', 'error');
        }
    }

    async function handleCreateMovement(event) {
        event.preventDefault();

        const normalizedCategory = normalizeCategoryLabel(movementForm.category);
        const parsedProductId = Math.trunc(parseFlexibleNumber(movementForm.productId, NaN));
        const selectedProduct = selectedMovementProduct
            || products.find((item) => Number(item.id) === parsedProductId)
            || null;
        const productId = selectedProduct ? Number(selectedProduct.id) : parsedProductId;
        const quantity = Math.trunc(parseFlexibleNumber(movementForm.quantity, NaN));
        const reason = String(movementForm.reason || '').trim();
        const type = String(movementForm.type || '').trim();

        if (!normalizedCategory || normalizedCategory === 'Não informada') {
            notify('Selecione uma categoria para registrar a movimentação.', 'error');
            return;
        }

        if (!Number.isFinite(productId) || productId < 1) {
            notify('Selecione um produto válido para movimentação.', 'error');
            return;
        }

        const product = selectedProduct || products.find((item) => Number(item.id) === productId);
        if (!product) {
            notify('O produto selecionado não foi encontrado. Atualize a tela e tente novamente.', 'error');
            return;
        }

        if (!['entrada', 'saida'].includes(type)) {
            notify('Tipo de movimentação inválido.', 'error');
            return;
        }

        if (!Number.isFinite(quantity) || quantity < 1) {
            notify('Informe uma quantidade válida maior ou igual a zero.', 'error');
            return;
        }

        if (!reason) {
            notify('Informe o motivo da movimentação.', 'error');
            return;
        }

        const payload = {
            type,
            quantity,
            reason
        };

        await registerProductMovement(productId, payload, { resetForm: true });
    }

    async function handleRegister(event) {
        event.preventDefault();
        const name = String(registerForm.name || '').trim();
        const email = String(registerForm.email || '').trim().toLowerCase();
        const password = registerForm.password;
        const confirmPassword = registerForm.confirmPassword;

        if (!name || !email) {
            setAuthFeedback({ type: 'error', text: 'Informe nome e e-mail válidos.' });
            return;
        }

        if (password.length < 8 || !/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/\d/.test(password) || !/[^\w\s]/.test(password)) {
            setAuthFeedback({ type: 'error', text: 'Senha fraca. Use 8+ caracteres com maiúscula, minúscula, número e símbolo.' });
            return;
        }

        if (password !== confirmPassword) {
            setAuthFeedback({ type: 'error', text: 'A confirmação da senha não confere.' });
            return;
        }

        try {
            await api.register({ name, email, password });
            setRegisterForm({ name: '', email, password: '', confirmPassword: '' });
            setAuthTab('login');
            setLoginForm((current) => ({ ...current, email }));
            setAuthFeedback({ type: 'success', text: 'Conta criada com sucesso. Agora faça login.' });
        } catch (error) {
            setApiStatus({ kind: 'offline', text: 'API offline' });
            setAuthFeedback({ type: 'error', text: error.message || 'Falha ao criar conta.' });
        }
    }

    async function handleRecovery(event) {
        event.preventDefault();
        const email = String(recoveryForm.email || '').trim().toLowerCase();
        const newPassword = recoveryForm.newPassword;
        const confirmPassword = recoveryForm.confirmPassword;

        if (!email) {
            setAuthFeedback({ type: 'error', text: 'Informe um e-mail válido.' });
            return;
        }

        if (newPassword.length < 8 || !/[A-Z]/.test(newPassword) || !/[a-z]/.test(newPassword) || !/\d/.test(newPassword) || !/[^\w\s]/.test(newPassword)) {
            setAuthFeedback({ type: 'error', text: 'Senha fraca. Use 8+ caracteres com maiúscula, minúscula, número e símbolo.' });
            return;
        }

        if (newPassword !== confirmPassword) {
            setAuthFeedback({ type: 'error', text: 'A confirmação da senha não confere.' });
            return;
        }

        try {
            await api.recover({ email, newPassword });
            setRecoveryForm({ email, newPassword: '', confirmPassword: '' });
            setAuthTab('login');
            setLoginForm((current) => ({ ...current, email }));
            setAuthFeedback({ type: 'success', text: 'Senha redefinida com sucesso. Faça login.' });
        } catch (error) {
            setApiStatus({ kind: 'offline', text: 'API offline' });
            setAuthFeedback({ type: 'error', text: error.message || 'Falha ao recuperar senha.' });
        }
    }

    async function handleAddProduct(event) {
        event.preventDefault();

        const payload = {
            nome: productForm.nome.trim(),
            patrimonio: productForm.patrimonio.trim(),
            categoria: productForm.categoria,
            quantidade: Number(productForm.quantidade),
            preco: Number(productForm.preco),
            descricao: productForm.descricao.trim()
        };

        if (!payload.nome || !payload.categoria || payload.quantidade < 1 || payload.preco < 0) {
            notify('Preencha os campos obrigatórios corretamente.', 'error');
            return;
        }

        try {
            const created = await api.createProduct(payload);
            setProducts((current) => [created, ...current]);
            setProductForm({ nome: '', patrimonio: '', categoria: '', quantidade: 1, preco: '', descricao: '' });
            notify('Produto adicionado com sucesso!', 'success');
        } catch (error) {
            if (error.status === 401) {
                handleLogout('Sessão expirada. Entre novamente.');
                return;
            }
            notify(error.message || 'Não foi possível adicionar o produto.', 'error');
        }
    }

    async function handleSaveEdit(event) {
        event.preventDefault();
        if (!editingProduct) return;

        const payload = {
            ...editingProduct,
            nome: editForm.nome.trim(),
            patrimonio: editForm.patrimonio.trim(),
            categoria: editForm.categoria,
            quantidade: Number(editForm.quantidade),
            preco: Number(editForm.preco),
            descricao: editForm.descricao.trim()
        };

        if (!payload.nome || !payload.categoria || payload.quantidade < 0 || payload.preco < 0) {
            notify('Preencha os campos obrigatórios corretamente.', 'error');
            return;
        }

        try {
            const updated = await api.updateProduct(editingProduct.id, payload);
            setProducts((current) => current.map((item) => (item.id === updated.id ? updated : item)));
            setEditingProduct(null);
            notify('Produto atualizado com sucesso!', 'success');
        } catch (error) {
            if (error.status === 401) {
                handleLogout('Sessão expirada. Entre novamente.');
                return;
            }
            notify(error.message || 'Não foi possível salvar a edição.', 'error');
        }
    }

    async function handleDeleteProduct(id) {
        if (!confirm('Tem certeza que deseja deletar este produto?')) return;

        try {
            await api.deleteProduct(id);
            setProducts((current) => current.filter((item) => item.id !== id));
            notify('Produto deletado com sucesso!', 'success');
        } catch (error) {
            if (error.status === 401) {
                handleLogout('Sessão expirada. Entre novamente.');
                return;
            }
            notify(error.message || 'Não foi possível deletar o produto.', 'error');
        }
    }

    async function handleDeleteMovement(movement) {
        if (!confirm('Tem certeza que deseja excluir esta movimentação? O estoque será ajustado.')) return;

        try {
            const result = await api.deleteMovement(movement.id);

            if (result?.product) {
                setProducts((current) => current.map((item) => (String(item.id) === String(result.product.id) ? result.product : item)));
            }

            setMovements((current) => current.filter((item) => String(item.id) !== String(movement.id)));
            notify('Movimentação excluída com sucesso!', 'success');
        } catch (error) {
            if (error.status === 401) {
                handleLogout('Sessão expirada. Entre novamente.');
                return;
            }
            notify(error.message || 'Não foi possível excluir a movimentação.', 'error');
        }
    }

    async function handleImportFile(event) {
        const file = event.target.files[0];
        if (!file) return;

        const extension = file.name.split('.').pop().toLowerCase();

        try {
            if (extension === 'json') {
                const content = await file.text();
                const parsed = JSON.parse(content);
                const items = parsed.produtos || parsed;
                await api.importProducts(Array.isArray(items) ? items : []);
            } else if (extension === 'xml') {
                await api.importXml(await file.text());
                                                    <th>Ações</th>
            } else if (extension === 'xlsx' || extension === 'xls' || extension === 'pdf') {
                await api.importFile(file);
            } else {
                throw new Error('Formato não suportado. Use JSON, XML, XLSX ou PDF.');
            }
                                                        <td colSpan="10" className="movement-empty">Nenhuma movimentação registrada.</td>
            await loadProductsAfterChange();
            notify('Dados importados com sucesso!', 'success');
        } catch (error) {
            notify(error.message || 'Erro ao importar arquivo.', 'error');
        } finally {
            event.target.value = '';
        }
    }

    async function handleExportXlsx() {
        try {
            await api.download('/products/export/xlsx', `estoque_${new Date().toISOString().split('T')[0]}.xlsx`);
            notify('Dados exportados em XLSX com sucesso!', 'success');
        } catch (error) {
            notify(error.message || 'Erro ao exportar XLSX.', 'error');
        }
    }

    async function handleExportPdf() {
        try {
            await api.download('/products/export/pdf', `estoque_${new Date().toISOString().split('T')[0]}.pdf`);
            notify('Dados exportados em PDF com sucesso!', 'success');
        } catch (error) {
            notify(error.message || 'Erro ao exportar PDF.', 'error');
        }
    }

    async function handleExportKpiPdf() {
        if (!dashboardReportRef.current) {
            notify('Área de relatório não encontrada.', 'error');
            return;
        }

        if (!window.html2canvas || !window.jspdf?.jsPDF) {
            notify('Bibliotecas de exportação indisponíveis.', 'error');
            return;
        }

        try {
            setExportingKpiPdf(true);

            // Aguarda a renderização final de gráficos e animações antes da captura.
            await new Promise((resolve) => setTimeout(resolve, 350));

            const canvas = await window.html2canvas(dashboardReportRef.current, {
                backgroundColor: '#ffffff',
                scale: 2,
                useCORS: true
            });

            const imgData = canvas.toDataURL('image/png');
            const { jsPDF } = window.jspdf;
            const pdf = new jsPDF('p', 'mm', 'a4');
            const pageWidth = pdf.internal.pageSize.getWidth();
            const pageHeight = pdf.internal.pageSize.getHeight();
            const margin = 10;
            const imgWidth = pageWidth - margin * 2;
            const imgHeight = (canvas.height * imgWidth) / canvas.width;
            const printableHeight = pageHeight - margin * 2;

            let heightLeft = imgHeight;
            let yPosition = margin;

            pdf.addImage(imgData, 'PNG', margin, yPosition, imgWidth, imgHeight);
            heightLeft -= printableHeight;

            while (heightLeft > 0) {
                pdf.addPage();
                yPosition = margin - (imgHeight - heightLeft);
                pdf.addImage(imgData, 'PNG', margin, yPosition, imgWidth, imgHeight);
                heightLeft -= printableHeight;
            }

            pdf.save(`relatorio_kpi_${new Date().toISOString().split('T')[0]}.pdf`);
            notify('Relatório KPI exportado em PDF com sucesso!', 'success');
        } catch (error) {
            notify(error.message || 'Erro ao exportar relatório KPI.', 'error');
        } finally {
            setExportingKpiPdf(false);
        }
    }

    async function handleClearAll() {
        if (!confirm('Tem certeza que deseja limpar todos os dados? Esta ação não pode ser desfeita!')) return;

        try {
            await api.importProducts([]);
            setProducts([]);
            notify('Todos os dados foram limpos!', 'success');
        } catch (error) {
            notify(error.message || 'Erro ao limpar dados.', 'error');
        }
    }

    async function handleCreateBackupNow() {
        try {
            setLoadingBackups(true);
            const { blob, filename } = await api.exportBackup();

            if (window.showSaveFilePicker) {
                try {
                    const handle = await window.showSaveFilePicker({
                        suggestedName: filename,
                        types: [
                            {
                                description: 'Arquivo JSON de backup',
                                accept: { 'application/json': ['.json'] }
                            }
                        ]
                    });

                    const writable = await handle.createWritable();
                    await writable.write(blob);
                    await writable.close();
                    notify('Backup salvo com sucesso no local escolhido!', 'success');
                } catch (error) {
                    if (error?.name === 'AbortError') {
                        notify('Salvamento de backup cancelado.', 'warning');
                    } else {
                        throw error;
                    }
                }
            } else {
                const url = URL.createObjectURL(blob);
                const link = document.createElement('a');
                link.href = url;
                link.download = filename;
                link.click();
                URL.revokeObjectURL(url);
                notify('Backup baixado. Se necessário, mova o arquivo para a pasta desejada.', 'success');
            }
        } catch (error) {
            notify(error.message || 'Erro ao criar backup.', 'error');
        } finally {
            setLoadingBackups(false);
        }
    }

    async function handleSaveBackupConfig(event) {
        event.preventDefault();

        if (backupConfig.backupMode === 'automatic' && !backupConfig.backupScheduleTime) {
            notify('Informe um horário para o backup automático.', 'error');
            return;
        }

        try {
            setSavingBackupConfig(true);
            await api.updateBackupConfig({
                backupMode: backupConfig.backupMode,
                backupScheduleDay: Number(backupConfig.backupScheduleDay),
                backupScheduleTime: backupConfig.backupScheduleTime
            });
            notify('Configuração de backup salva com sucesso!', 'success');
        } catch (error) {
            notify(error.message || 'Erro ao salvar configuração de backup.', 'error');
        } finally {
            setSavingBackupConfig(false);
        }
    }

    async function handleRestoreBackup(filename) {
        if (!confirm(`Deseja restaurar o backup "${filename}"? Os dados atuais serão sobrescrito.`)) return;

        try {
            setLoadingBackups(true);
            await api.restoreBackup(filename);
            await loadProductsAfterChange();
            notify('Backup restaurado com sucesso!', 'success');
        } catch (error) {
            notify(error.message || 'Erro ao restaurar backup.', 'error');
        } finally {
            setLoadingBackups(false);
        }
    }

    function togglePassword(key) {
        setShowPasswords((current) => ({ ...current, [key]: !current[key] }));
    }

    function setAuthMessage(type, text) {
        setAuthFeedback({ type, text });
    }

    function openProfilePhotoModal() {
        setProfilePhotoDraft({ ...profilePhotoConfig });
        setShowProfilePhotoModal(true);
    }

    function closeProfilePhotoModal() {
        setShowProfilePhotoModal(false);
        setProfilePhotoDraft({ ...profilePhotoConfig });
    }

    function saveProfilePhotoConfig(nextConfig) {
        if (!profilePhotoStorageKey) {
            notify('Não foi possível salvar a foto do usuário.', 'error');
            return;
        }

        try {
            if (!nextConfig?.src) {
                localStorage.removeItem(profilePhotoStorageKey);
                setProfilePhotoConfig({ ...DEFAULT_PROFILE_PHOTO_CONFIG });
                notify('Foto do usuário removida.', 'success');
                return;
            }

            const payload = {
                src: String(nextConfig.src),
                zoom: Number(nextConfig.zoom) >= 1 ? Math.min(2.5, Number(nextConfig.zoom)) : 1,
                offsetX: Number.isFinite(Number(nextConfig.offsetX)) ? Math.max(-35, Math.min(35, Number(nextConfig.offsetX))) : 0,
                offsetY: Number.isFinite(Number(nextConfig.offsetY)) ? Math.max(-35, Math.min(35, Number(nextConfig.offsetY))) : 0
            };

            localStorage.setItem(profilePhotoStorageKey, JSON.stringify(payload));
            setProfilePhotoConfig(payload);
            notify('Foto do usuário atualizada com sucesso!', 'success');
        } catch {
            notify('Não foi possível salvar a foto no navegador.', 'error');
        }
    }

    function handleSaveProfilePhotoAdjustments() {
        saveProfilePhotoConfig(profilePhotoDraft);
        setShowProfilePhotoModal(false);
    }

    function handleSelectProfilePhoto(event) {
        const file = event.target.files?.[0];
        if (!file) return;

        if (!file.type.startsWith('image/')) {
            notify('Selecione um arquivo de imagem válido.', 'error');
            event.target.value = '';
            return;
        }

        if (file.size > PROFILE_PHOTO_MAX_SIZE_BYTES) {
            notify('A foto deve ter no máximo 4MB.', 'error');
            event.target.value = '';
            return;
        }

        const reader = new FileReader();
        reader.onload = () => {
            const result = String(reader.result || '');
            if (!result) {
                notify('Não foi possível carregar a foto do usuário.', 'error');
                return;
            }

            const nextDraft = {
                src: result,
                zoom: 1,
                offsetX: 0,
                offsetY: 0
            };

            setProfilePhotoDraft(nextDraft);
            setShowProfilePhotoModal(true);
        };

        reader.onerror = () => {
            notify('Falha ao ler o arquivo da foto.', 'error');
        };

        reader.readAsDataURL(file);
        event.target.value = '';
    }

    if (!bootstrapped) {
        return (
            <div className="auth-shell">
                <div className="auth-card">
                    <div className="auth-panel" style={{ minHeight: '320px', display: 'grid', placeItems: 'center' }}>
                        <p className="auth-hint" style={{ color: '#334155' }}>Carregando aplicação...</p>
                    </div>
                </div>
            </div>
        );
    }

    const sessionUser = showApp ? session : null;

    return (
        <>
            {notice ? (
                <div style={{
                    position: 'fixed',
                    top: '20px',
                    right: '20px',
                    padding: '14px 18px',
                    background: notice.type === 'success'
                        ? '#10b981'
                        : notice.type === 'error'
                            ? '#ef4444'
                            : notice.type === 'warning'
                                ? '#f59e0b'
                                : '#4f46e5',
                    color: 'white',
                    borderRadius: '10px',
                    boxShadow: '0 10px 24px rgba(0,0,0,0.16)',
                    zIndex: 3000,
                    maxWidth: '320px'
                }}>{notice.text}</div>
            ) : null}

            {!showApp ? (
                <div className="auth-shell">
                    <div className="auth-card">
                        <div className="auth-layout">
                            <aside className="auth-spotlight">
                                <div className="auth-brand">
                                    <span className="auth-eyebrow">Controle inteligente</span>
                                    <h1>Estoque com acesso rápido, seguro e moderno</h1>
                                    <p>Uma entrada visual mais clara para entrar, cadastrar ou recuperar sua conta sem fricção.</p>
                                </div>

                                <div className="auth-highlights">
                                    <div className="auth-highlight-card">
                                        <strong>JWT</strong>
                                        <span>Sessão segura e centralizada</span>
                                    </div>
                                    <div className="auth-highlight-card">
                                        <strong>24h</strong>
                                        <span>Opção de sessão estendida</span>
                                    </div>
                                    <div className="auth-highlight-card">
                                        <strong>API</strong>
                                        <span>Validação em tempo real</span>
                                    </div>
                                </div>

                                <ul className="auth-points">
                                    <li>Fluxo enxuto para login, cadastro e recuperação.</li>
                                    <li>Campos com foco claro e feedback imediato.</li>
                                    <li>Visual adaptado para desktop e mobile.</li>
                                </ul>
                            </aside>

                            <section className="auth-panel">
                                <div id="apiStatusAuth" className={`api-status ${apiStatus.kind}`} role="status" aria-live="polite">
                                    <span className="api-dot" aria-hidden="true"></span>
                                    <span className="api-status-text">{apiStatus.text}</span>
                                </div>

                                <div className="auth-tabs">
                                    <button id="showLoginTab" className={`auth-tab ${authTab === 'login' ? 'active' : ''}`} type="button" onClick={() => setAuthTab('login')}>Entrar</button>
                                    <button id="showRegisterTab" className={`auth-tab ${authTab === 'register' ? 'active' : ''}`} type="button" onClick={() => setAuthTab('register')}>Cadastrar</button>
                                    <button id="showRecoveryTab" className={`auth-tab ${authTab === 'recovery' ? 'active' : ''}`} type="button" onClick={() => setAuthTab('recovery')}>Recuperar</button>
                                </div>

                                {authTab === 'login' ? (
                                    <form id="loginForm" className="auth-form active" onSubmit={handleLogin}>
                                        <div className="form-group">
                                            <label htmlFor="loginEmail">E-mail</label>
                                            <FieldShell icon="✉">
                                                <input
                                                    type="email"
                                                    id="loginEmail"
                                                    placeholder="exemplo@empresa.com"
                                                    autoComplete="email"
                                                    value={loginForm.email}
                                                    onChange={(event) => setLoginForm((current) => ({ ...current, email: event.target.value }))}
                                                    required
                                                />
                                            </FieldShell>
                                        </div>
                                        <div className="form-group">
                                            <label htmlFor="loginPassword">Senha</label>
                                            <PasswordField
                                                id="loginPassword"
                                                value={loginForm.password}
                                                onChange={(event) => setLoginForm((current) => ({ ...current, password: event.target.value }))}
                                                placeholder="Digite sua senha"
                                                show={showPasswords.login}
                                                onToggle={() => togglePassword('login')}
                                                autoComplete="current-password"
                                            />
                                        </div>
                                        <div className="remember-row">
                                            <label className="checkbox-label" htmlFor="rememberSession">
                                                <input
                                                    type="checkbox"
                                                    id="rememberSession"
                                                    checked={loginForm.remember}
                                                    onChange={(event) => setLoginForm((current) => ({ ...current, remember: event.target.checked }))}
                                                />
                                                <span>Manter sessão por 24h</span>
                                            </label>
                                        </div>
                                        <button id="goRecoveryFromLogin" className="auth-link" type="button" onClick={() => { setAuthTab('recovery'); setAuthMessage('info', 'Digite seu e-mail para redefinir a senha.'); }}>Esqueci minha senha</button>
                                        <button type="submit" className="btn btn-primary">Entrar no sistema</button>
                                    </form>
                                ) : null}

                                {authTab === 'register' ? (
                                    <form id="registerForm" className="auth-form active" onSubmit={handleRegister}>
                                        <div className="form-group">
                                            <label htmlFor="registerName">Nome</label>
                                            <FieldShell icon="👤">
                                                <input
                                                    type="text"
                                                    id="registerName"
                                                    placeholder="Seu nome"
                                                    value={registerForm.name}
                                                    onChange={(event) => setRegisterForm((current) => ({ ...current, name: event.target.value }))}
                                                    required
                                                />
                                            </FieldShell>
                                        </div>
                                        <div className="form-group">
                                            <label htmlFor="registerEmail">E-mail</label>
                                            <FieldShell icon="✉">
                                                <input
                                                    type="email"
                                                    id="registerEmail"
                                                    placeholder="exemplo@empresa.com"
                                                    autoComplete="email"
                                                    value={registerForm.email}
                                                    onChange={(event) => setRegisterForm((current) => ({ ...current, email: event.target.value }))}
                                                    required
                                                />
                                            </FieldShell>
                                        </div>
                                        <div className="form-group">
                                            <label htmlFor="registerPassword">Senha</label>
                                            <PasswordField
                                                id="registerPassword"
                                                value={registerForm.password}
                                                onChange={(event) => setRegisterForm((current) => ({ ...current, password: event.target.value }))}
                                                placeholder="Mínimo 8, com maiúscula, número e símbolo"
                                                show={showPasswords.register}
                                                onToggle={() => togglePassword('register')}
                                                autoComplete="new-password"
                                            />
                                            {(() => {
                                                const strength = getPasswordStrength(registerForm.password);
                                                return <div className="password-meter" aria-hidden="true"><span style={{ width: `${strength.percent}%` }}></span></div>;
                                            })()}
                                            <small className="field-help">Força da senha: {registerForm.password ? getPasswordStrength(registerForm.password).label : '-'}</small>
                                        </div>
                                        <div className="form-group">
                                            <label htmlFor="registerConfirmPassword">Confirmar senha</label>
                                            <FieldShell icon="🔐">
                                                <input
                                                    type="password"
                                                    id="registerConfirmPassword"
                                                    placeholder="Repita a senha"
                                                    value={registerForm.confirmPassword}
                                                    onChange={(event) => setRegisterForm((current) => ({ ...current, confirmPassword: event.target.value }))}
                                                    autoComplete="new-password"
                                                    required
                                                />
                                            </FieldShell>
                                        </div>
                                        <button type="submit" className="btn btn-primary">Criar conta</button>
                                    </form>
                                ) : null}

                                {authTab === 'recovery' ? (
                                    <form id="recoveryForm" className="auth-form active" onSubmit={handleRecovery}>
                                        <div className="form-group">
                                            <label htmlFor="recoveryEmail">E-mail cadastrado</label>
                                            <FieldShell icon="✉">
                                                <input
                                                    type="email"
                                                    id="recoveryEmail"
                                                    placeholder="exemplo@empresa.com"
                                                    autoComplete="email"
                                                    value={recoveryForm.email}
                                                    onChange={(event) => setRecoveryForm((current) => ({ ...current, email: event.target.value }))}
                                                    required
                                                />
                                            </FieldShell>
                                        </div>
                                        <div className="form-group">
                                            <label htmlFor="newRecoveryPassword">Nova senha</label>
                                            <PasswordField
                                                id="newRecoveryPassword"
                                                value={recoveryForm.newPassword}
                                                onChange={(event) => setRecoveryForm((current) => ({ ...current, newPassword: event.target.value }))}
                                                placeholder="Mínimo 8, com maiúscula, número e símbolo"
                                                show={showPasswords.recovery}
                                                onToggle={() => togglePassword('recovery')}
                                                autoComplete="new-password"
                                            />
                                            {(() => {
                                                const strength = getPasswordStrength(recoveryForm.newPassword);
                                                return <div className="password-meter" aria-hidden="true"><span style={{ width: `${strength.percent}%` }}></span></div>;
                                            })()}
                                            <small className="field-help">Força da senha: {recoveryForm.newPassword ? getPasswordStrength(recoveryForm.newPassword).label : '-'}</small>
                                        </div>
                                        <div className="form-group">
                                            <label htmlFor="confirmRecoveryPassword">Confirmar nova senha</label>
                                            <FieldShell icon="🔐">
                                                <input
                                                    type="password"
                                                    id="confirmRecoveryPassword"
                                                    placeholder="Repita a nova senha"
                                                    value={recoveryForm.confirmPassword}
                                                    onChange={(event) => setRecoveryForm((current) => ({ ...current, confirmPassword: event.target.value }))}
                                                    autoComplete="new-password"
                                                    required
                                                />
                                            </FieldShell>
                                        </div>
                                        <button type="submit" className="btn btn-primary">Redefinir senha</button>
                                        <button id="backToLoginFromRecovery" className="auth-link" type="button" onClick={() => { setAuthTab('login'); setAuthMessage('info', 'Informe suas credenciais para entrar.'); }}>Voltar para login</button>
                                    </form>
                                ) : null}

                                <p id="authFeedback" className={`auth-feedback ${authFeedback.type}`} role="status" aria-live="polite">{authFeedback.text}</p>
                                <p className="auth-hint">Usuário padrão para teste: admin@estoque.com / admin123</p>
                            </section>
                        </div>
                    </div>
                </div>
            ) : (
                <div id="appContainer" className="container" aria-hidden="false">
                    <header>
                        <h1>📦 Controle de Estoque</h1>
                        <p className="subtitle">Gerencie seus produtos de forma simples e eficiente</p>
                        <div id="apiStatusApp" className={`api-status ${apiStatus.kind}`} role="status" aria-live="polite">
                            <span className="api-dot" aria-hidden="true"></span>
                            <span className="api-status-text">{apiStatus.text}</span>
                        </div>
                        <div className="session-info">
                            <div className="profile-avatar-wrap">
                                <button
                                    type="button"
                                    className="profile-avatar-btn"
                                    aria-label="Visualizar e ajustar foto do usuário"
                                    title="Visualizar e ajustar foto do usuário"
                                    onClick={openProfilePhotoModal}
                                >
                                    {profilePhotoConfig.src ? (
                                        <img
                                            src={profilePhotoConfig.src}
                                            alt="Foto do usuário"
                                            className="profile-avatar-image"
                                            style={getProfilePhotoStyle(profilePhotoConfig)}
                                        />
                                    ) : (
                                        <span className="profile-avatar-initial">
                                            {getUserInitial(sessionUser ? (sessionUser.name || sessionUser.email) : '')}
                                        </span>
                                    )}
                                </button>
                                <input
                                    type="file"
                                    accept="image/*"
                                    ref={profilePhotoInputRef}
                                    style={{ display: 'none' }}
                                    onChange={handleSelectProfilePhoto}
                                />
                            </div>
                            <span id="loggedUserText">{sessionUser ? `${sessionUser.name || sessionUser.email} · ${sessionUser.email}` : ''}</span>
                            <span className="current-datetime" aria-live="polite">{nowLabel}</span>
                            <div className="notification-wrap" ref={notificationMenuRef}>
                                <button
                                    type="button"
                                    className={`notification-bell ${unreadNotificationCount ? 'has-unread' : ''}`}
                                    onClick={handleToggleNotificationMenu}
                                    aria-label={`Notificações (${unreadNotificationCount} não lida(s))`}
                                    aria-expanded={showNotificationMenu}
                                    title="Notificações de estoque"
                                >
                                    <svg className="notification-bell-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                                        <path d="M12 22a2.3 2.3 0 0 0 2.3-2.3h-4.6A2.3 2.3 0 0 0 12 22zm6.2-6.1V11a6.2 6.2 0 0 0-4.9-6.1V4a1.3 1.3 0 0 0-2.6 0v.9A6.2 6.2 0 0 0 5.8 11v4.9l-1.7 1.7a1 1 0 0 0 .7 1.7h14.4a1 1 0 0 0 .7-1.7l-1.7-1.7z"></path>
                                    </svg>
                                    {unreadNotificationCount > 0 ? <span className="notification-badge">{unreadNotificationCount > 99 ? '99+' : unreadNotificationCount}</span> : null}
                                </button>
                                <div className={`notification-dropdown ${showNotificationMenu ? 'show' : ''}`} role="dialog" aria-label="Notificações de estoque">
                                    <div className="notification-dropdown-header">
                                        <strong>Notificações</strong>
                                        <div className="notification-actions">
                                            <button
                                                type="button"
                                                className="notification-mark-read"
                                                onClick={markAllNotificationsAsRead}
                                                disabled={!visibleHeaderNotifications.length}
                                            >
                                                Marcar como lidas
                                            </button>
                                            <button
                                                type="button"
                                                className="notification-clear"
                                                onClick={clearNotifications}
                                                disabled={!visibleHeaderNotifications.length}
                                            >
                                                Limpar notificações
                                            </button>
                                        </div>
                                    </div>
                                    {visibleHeaderNotifications.length === 0 ? (
                                        <p className="notification-empty">Sem notificações no momento.</p>
                                    ) : (
                                        <ul className="notification-list">
                                            {visibleHeaderNotifications.map((item) => (
                                                <li
                                                    key={item.id}
                                                    className={`notification-item ${item.type} ${readNotificationIdSet.has(item.id) ? '' : 'unread'}`}
                                                >
                                                    <div className="notification-item-head">
                                                        <strong>{item.title}</strong>
                                                        <span>{item.timeLabel}</span>
                                                    </div>
                                                    <p>{item.message}</p>
                                                    <small>{item.meta}</small>
                                                </li>
                                            ))}
                                        </ul>
                                    )}
                                </div>
                            </div>
                            <button id="logoutBtn" className="btn btn-secondary" type="button" onClick={() => handleLogout('Sessão encerrada com sucesso.')}>Sair</button>
                        </div>
                        <div className="view-tabs">
                            <button id="inventoryViewBtn" className={`view-tab ${activeView === 'inventory' ? 'active' : ''}`} type="button" onClick={() => setActiveView('inventory')}>Estoque</button>
                            <button id="movementsViewBtn" className={`view-tab ${activeView === 'movements' ? 'active' : ''}`} type="button" onClick={() => setActiveView('movements')}>Movimentações</button>
                            <button id="dashboardViewBtn" className={`view-tab ${activeView === 'dashboard' ? 'active' : ''}`} type="button" onClick={() => setActiveView('dashboard')}>Dashboard</button>
                            <button id="backupsViewBtn" className={`view-tab ${activeView === 'backups' ? 'active' : ''}`} type="button" onClick={() => setActiveView('backups')}>💾 Backups</button>
                        </div>
                    </header>

                    <main>
                        <section className={`dashboard-section app-view ${activeView === 'dashboard' ? 'active' : ''}`} data-view="dashboard">
                            <div className="section-heading">
                                <h2>Dashboard do Estoque</h2>
                                <p>Percentuais e distribuição atual com base no estoque registrado.</p>
                            </div>

                            <div className="dashboard-toolbar">
                                <label htmlFor="dashboardPeriodSelect">Período analisado</label>
                                <select id="dashboardPeriodSelect" value={dashboardPeriod} onChange={(event) => setDashboardPeriod(event.target.value)}>
                                    <option value="all">Todo o estoque</option>
                                    <option value="1">Hoje</option>
                                    <option value="7">Últimos 7 dias</option>
                                    <option value="30">Últimos 30 dias</option>
                                    <option value="90">Últimos 90 dias</option>
                                </select>
                                <button
                                    type="button"
                                    className="btn btn-secondary"
                                    onClick={handleExportKpiPdf}
                                    disabled={exportingKpiPdf}
                                >
                                    {exportingKpiPdf ? 'Gerando PDF...' : '📄 Exportar relatório KPI (PDF)'}
                                </button>
                            </div>

                            <div ref={dashboardReportRef}>
                            <div className="dashboard-summary">
                                <div className="dashboard-card accent-blue">
                                    <span className="dashboard-label">Produtos com baixo estoque</span>
                                    <strong id="dashLowStockPct">{lowStockPct.toFixed(1)}%</strong>
                                    <small id="dashLowStockDetail">{dashboardData.produtosBaixos} de {dashboardData.totalProdutos} produtos em {periodLabel}</small>
                                </div>
                                <div className="dashboard-card accent-green">
                                    <span className="dashboard-label">Produtos saudáveis</span>
                                    <strong id="dashItemsPct">{healthyPct.toFixed(1)}%</strong>
                                    <small id="dashItemsDetail">{productsHealthy} de {dashboardData.totalProdutos} produtos sem alerta em {periodLabel}</small>
                                </div>
                                <div className="dashboard-card accent-orange">
                                    <span className="dashboard-label">Categoria mais valiosa</span>
                                    <strong id="dashValuePct">{topValueCategory ? `${topValuePct.toFixed(1)}%` : '0%'}</strong>
                                    <small id="dashValueDetail">{topValueCategory ? `${topValueCategory[0]} lidera o valor total em ${periodLabel}` : '0 categorias analisadas'}</small>
                                </div>
                                <div className="dashboard-card accent-purple">
                                    <span className="dashboard-label">Categoria dominante</span>
                                    <strong id="dashTopCategory">{topCategory ? topCategory[0] : '-'}</strong>
                                    <small id="dashTopCategoryDetail">{topCategory ? `${((topCategory[1].quantidade / totalCategoryQty) * 100).toFixed(1)}% do total de itens em ${periodLabel}` : '0%'}</small>
                                </div>
                            </div>

                            <div className="dashboard-summary" style={{ marginTop: '16px' }}>
                                <div className="dashboard-card accent-green">
                                    <span className="dashboard-label">Entradas no período</span>
                                    <strong>{dashboardFlow.entryCount}</strong>
                                    <small>{dashboardFlow.entryQuantity} item(ns) adicionados</small>
                                </div>
                                <div className="dashboard-card accent-blue">
                                    <span className="dashboard-label">Saídas no período</span>
                                    <strong>{dashboardFlow.exitCount}</strong>
                                    <small>{dashboardFlow.exitQuantity} item(ns) retirados</small>
                                </div>
                                <div className="dashboard-card accent-orange">
                                    <span className="dashboard-label">Saldo líquido</span>
                                    <strong>{flowBalanceLabel}</strong>
                                    <small>{dashboardFlow.totalMovements} movimentação(ões) em {periodLabel}</small>
                                </div>
                            </div>

                            <section className="kpi-report">
                                <div className="section-heading compact">
                                    <h3>Relatórios visuais com KPIs</h3>
                                    <p>Indicadores-chave para leitura rápida da performance do estoque em {periodLabel}.</p>
                                </div>
                                <div className="kpi-grid">
                                    {kpiCards.map((kpi) => (
                                        <article className={`kpi-card tone-${kpi.tone}`} key={kpi.title}>
                                            <span className="kpi-title">{kpi.title}</span>
                                            <strong className="kpi-value">{kpi.value}</strong>
                                            <small className="kpi-subtitle">{kpi.subtitle}</small>
                                            <div className="kpi-track" aria-hidden="true">
                                                <div className="kpi-fill" style={{ width: `${Math.max(0, Math.min(100, kpi.progress)).toFixed(1)}%` }}></div>
                                            </div>
                                        </article>
                                    ))}
                                </div>
                            </section>

                            <DashboardCharts
                                visible={activeView === 'dashboard'}
                                data={dashboardChartsData}
                                categoryEntries={categoryEntries}
                                totalCategoryQty={totalCategoryQty}
                                totalCategoryValue={totalCategoryValue}
                            />
                            </div>
                        </section>

                        <div className={`app-view ${activeView === 'movements' ? 'active' : ''}`} data-view="movements">
                            <section className="movement-section">
                                <div className="section-heading">
                                    <h2>Entrada e Saída de Estoque</h2>
                                    <p>Registre movimentações e acompanhe o histórico de alterações por produto.</p>
                                </div>

                                <div className="movement-layout">
                                    <form className="movement-form" onSubmit={handleCreateMovement}>
                                        <div className="form-group">
                                            <label htmlFor="movementCategory">Categoria</label>
                                            <select
                                                id="movementCategory"
                                                value={movementForm.category}
                                                onChange={(event) => setMovementForm((current) => ({ ...current, category: event.target.value, productId: '' }))}
                                                required
                                            >
                                                <option value="">Selecione uma categoria</option>
                                                {PRODUCT_CATEGORIES.map((category) => (
                                                    <option value={category} key={`movement_form_category_${category}`}>{category}</option>
                                                ))}
                                            </select>
                                        </div>

                                        <div className="form-group">
                                            <label htmlFor="movementProduct">Produto</label>
                                            <select
                                                id="movementProduct"
                                                value={movementForm.productId}
                                                onChange={(event) => setMovementForm((current) => ({ ...current, productId: event.target.value }))}
                                                disabled={!movementForm.category}
                                                required
                                            >
                                                {!movementForm.category ? <option value="">Selecione uma categoria primeiro</option> : null}
                                                {movementForm.category && movementProductsByCategory.length === 0 ? <option value="">Nenhum produto nessa categoria</option> : null}
                                                {movementProductsByCategory.map((product) => (
                                                    <option value={String(product.id)} key={product.id}>
                                                        {product.nome}
                                                        {product.patrimonio ? ` | Patrimônio: ${product.patrimonio}` : ''}
                                                        {` - ${normalizeCategoryLabel(product.categoria)} (estoque: ${Number(product.quantidade) || 0})`}
                                                    </option>
                                                ))}
                                            </select>
                                            {selectedMovementProduct ? (
                                                <p className="movement-selected-product">
                                                    Categoria: <strong>{normalizeCategoryLabel(selectedMovementProduct.categoria)}</strong>
                                                    {selectedMovementProduct.patrimonio ? <> | Patrimônio: <strong>{selectedMovementProduct.patrimonio}</strong></> : ''}
                                                    {' '}| Estoque atual: <strong>{Number(selectedMovementProduct.quantidade) || 0}</strong>
                                                </p>
                                            ) : null}
                                        </div>

                                        <div className="form-row">
                                            <div className="form-group">
                                                <label htmlFor="movementType">Tipo</label>
                                                <select
                                                    id="movementType"
                                                    value={movementForm.type}
                                                    onChange={(event) => setMovementForm((current) => ({ ...current, type: event.target.value }))}
                                                    required
                                                >
                                                    <option value="entrada">Entrada</option>
                                                    <option value="saida">Saída</option>
                                                </select>
                                            </div>

                                            <div className="form-group">
                                                <label htmlFor="movementQuantity">Quantidade</label>
                                                <input
                                                    id="movementQuantity"
                                                    type="number"
                                                    min="0"
                                                    value={movementForm.quantity}
                                                    onChange={(event) => setMovementForm((current) => ({ ...current, quantity: event.target.value }))}
                                                    required
                                                />
                                            </div>
                                        </div>

                                        <div className="form-group">
                                            <label htmlFor="movementReason">Motivo</label>
                                            <input
                                                id="movementReason"
                                                type="text"
                                                placeholder="Ex: Compra, venda, ajuste, perda"
                                                value={movementForm.reason}
                                                onChange={(event) => setMovementForm((current) => ({ ...current, reason: event.target.value }))}
                                                required
                                            />
                                        </div>

                                        <button type="submit" className="btn btn-primary" disabled={!products.length}>Registrar movimentação</button>
                                    </form>

                                    <div className="movement-filter-card">
                                        <h3>Filtros do histórico</h3>
                                        <div className="form-group">
                                            <label htmlFor="movementFilterProduct">Produto</label>
                                            <select
                                                id="movementFilterProduct"
                                                value={movementFilter.productId}
                                                onChange={(event) => setMovementFilter((current) => ({ ...current, productId: event.target.value }))}
                                            >
                                                <option value="">Todos os produtos</option>
                                                {movementFilter.category && movementFilterProductsByCategory.length === 0 ? <option value="">Nenhum produto nessa categoria</option> : null}
                                                {movementFilterProductsByCategory.map((product) => (
                                                    <option value={String(product.id)} key={`filter_${product.id}`}>
                                                        {product.nome}
                                                        {product.patrimonio ? ` | Patrimônio: ${product.patrimonio}` : ''}
                                                    </option>
                                                ))}
                                            </select>
                                        </div>

                                        <div className="form-group">
                                            <label htmlFor="movementFilterCategory">Categoria</label>
                                            <select
                                                id="movementFilterCategory"
                                                value={movementFilter.category}
                                                onChange={(event) => setMovementFilter((current) => ({ ...current, category: event.target.value, productId: '' }))}
                                            >
                                                <option value="">Todas as categorias</option>
                                                {PRODUCT_CATEGORIES.map((category) => (
                                                    <option value={category} key={`movement_category_${category}`}>{category}</option>
                                                ))}
                                            </select>
                                        </div>

                                        <div className="form-group">
                                            <label htmlFor="movementFilterType">Tipo</label>
                                            <select
                                                id="movementFilterType"
                                                value={movementFilter.type}
                                                onChange={(event) => setMovementFilter((current) => ({ ...current, type: event.target.value }))}
                                            >
                                                <option value="">Todos os tipos</option>
                                                <option value="entrada">Entrada</option>
                                                <option value="saida">Saída</option>
                                            </select>
                                        </div>

                                        <div className="form-group">
                                            <label htmlFor="movementFilterPeriod">Período</label>
                                            <select
                                                id="movementFilterPeriod"
                                                value={movementFilter.period}
                                                onChange={(event) => setMovementFilter((current) => ({ ...current, period: event.target.value }))}
                                            >
                                                <option value="all">Todo o histórico</option>
                                                <option value="1">Hoje</option>
                                                <option value="7">Últimos 7 dias</option>
                                                <option value="30">Últimos 30 dias</option>
                                                <option value="90">Últimos 90 dias</option>
                                            </select>
                                        </div>

                                        <div className="form-group">
                                            <label htmlFor="movementFilterOrder">Ordenação</label>
                                            <select
                                                id="movementFilterOrder"
                                                value={movementFilter.order}
                                                onChange={(event) => setMovementFilter((current) => ({ ...current, order: event.target.value }))}
                                            >
                                                <option value="recent">Mais recentes primeiro</option>
                                                <option value="oldest">Mais antigos primeiro</option>
                                            </select>
                                        </div>

                                        <p className="movement-period-hint">{movementPeriodLabel}</p>
                                        <div className="movement-filter-actions">
                                            <button
                                                type="button"
                                                className="btn btn-secondary"
                                                onClick={() => setMovementFilter({ productId: '', category: '', type: '', period: 'all', order: 'recent' })}
                                            >
                                                Limpar filtros
                                            </button>
                                        </div>
                                    </div>
                                </div>

                                <section className="movement-history">
                                    <h3>Histórico de movimentações</h3>
                                    <div className="movement-kpis">
                                        <article className="movement-kpi-card movement-kpi-total">
                                            <span>Total</span>
                                            <strong>{movementSummary.total}</strong>
                                        </article>
                                        <article className="movement-kpi-card movement-kpi-entry">
                                            <span>Entradas</span>
                                            <strong>{movementSummary.entries}</strong>
                                        </article>
                                        <article className="movement-kpi-card movement-kpi-exit">
                                            <span>Saídas</span>
                                            <strong>{movementSummary.exits}</strong>
                                        </article>
                                        <article className="movement-kpi-card movement-kpi-today">
                                            <span>Hoje</span>
                                            <strong>{movementSummary.todayCount}</strong>
                                        </article>
                                    </div>
                                    {loadingMovements ? <p className="empty-state">Carregando movimentações...</p> : null}
                                    <div className="movement-table-wrap">
                                        <table className="movement-table">
                                            <thead>
                                                <tr>
                                                    <th>Data e hora</th>
                                                    <th>Produto</th>
                                                    <th>Patrimônio</th>
                                                    <th>Descrição</th>
                                                    <th>Categoria</th>
                                                    <th>Tipo</th>
                                                    <th>Qtd</th>
                                                    <th>Saldo</th>
                                                    <th>Motivo</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {filteredMovements.length === 0 && !loadingMovements ? (
                                                    <tr>
                                                        <td colSpan="9" className="movement-empty">Nenhuma movimentação registrada.</td>
                                                    </tr>
                                                ) : null}
                                                {filteredMovements.map((movement) => (
                                                    <tr key={movement.id}>
                                                        <td>{formatDate(movement.createdAt)}</td>
                                                        <td>{movement.productName}</td>
                                                        <td>{movementPatrimonyByProductId.get(String(movement.productId)) || '-'}</td>
                                                        <td>{movementDescriptionByProductId.get(String(movement.productId)) || '-'}</td>
                                                        <td>{movementCategoryByProductId.get(String(movement.productId)) || 'Não informada'}</td>
                                                        <td>
                                                            <span className={`movement-badge ${movement.type === 'entrada' ? 'entry' : 'exit'}`}>
                                                                {movement.type === 'entrada' ? '▲ Entrada' : '▼ Saída'}
                                                            </span>
                                                        </td>
                                                        <td>{movement.quantity}</td>
                                                        <td>{movement.previousStock} → {movement.newStock}</td>
                                                        <td>{movement.reason}</td>
                                                        <td>
                                                            <div className="movement-actions">
                                                                <button
                                                                    className="action-btn delete"
                                                                    type="button"
                                                                    onClick={() => handleDeleteMovement(movement)}
                                                                    title="Excluir movimentação"
                                                                    aria-label="Excluir movimentação"
                                                                >
                                                                    🗑️
                                                                </button>
                                                            </div>
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                </section>
                            </section>
                        </div>

                        <div className={`app-view ${activeView === 'backups' ? 'active' : ''}`} data-view="backups">
                            <section className="form-section">
                                <h2>Backups do Sistema</h2>
                                <form className="backup-schedule-panel" onSubmit={handleSaveBackupConfig}>
                                    <div className="form-row">
                                        <div className="form-group">
                                            <label htmlFor="backupModeSelect">Modo de backup</label>
                                            <select
                                                id="backupModeSelect"
                                                value={backupConfig.backupMode}
                                                onChange={(event) => setBackupConfig((current) => ({ ...current, backupMode: event.target.value }))}
                                            >
                                                <option value="manual">Manual</option>
                                                <option value="automatic">Automático programado</option>
                                            </select>
                                        </div>

                                        {backupConfig.backupMode === 'automatic' ? (
                                            <>
                                                <div className="form-group">
                                                    <label htmlFor="backupScheduleDay">Dia da semana</label>
                                                    <select
                                                        id="backupScheduleDay"
                                                        value={backupConfig.backupScheduleDay}
                                                        onChange={(event) => setBackupConfig((current) => ({ ...current, backupScheduleDay: event.target.value }))}
                                                    >
                                                        {BACKUP_SCHEDULE_DAYS.map((item) => (
                                                            <option key={item.value} value={item.value}>{item.label}</option>
                                                        ))}
                                                    </select>
                                                </div>

                                                <div className="form-group">
                                                    <label htmlFor="backupScheduleTime">Horário</label>
                                                    <input
                                                        id="backupScheduleTime"
                                                        type="time"
                                                        value={backupConfig.backupScheduleTime}
                                                        onChange={(event) => setBackupConfig((current) => ({ ...current, backupScheduleTime: event.target.value }))}
                                                        required
                                                    />
                                                </div>
                                            </>
                                        ) : null}
                                    </div>

                                    <div className="backup-config-actions">
                                        <button type="submit" className="btn btn-secondary" disabled={savingBackupConfig}>
                                            {savingBackupConfig ? 'Salvando...' : 'Salvar configuração'}
                                        </button>
                                        <small className="backup-create-hint">
                                            {backupConfig.backupMode === 'manual'
                                                ? 'No modo manual, os backups acontecem somente ao clicar em Criar e Salvar Backup.'
                                                : 'No modo automático, o sistema cria backup no dia e horário programados.'}
                                        </small>
                                    </div>
                                </form>

                                <div className="backup-create-row">
                                    <button
                                        type="button"
                                        className="btn btn-primary"
                                        onClick={handleCreateBackupNow}
                                        disabled={loadingBackups}
                                    >
                                        {loadingBackups ? '⏳ Processando...' : '💾 Criar e Salvar Backup'}
                                    </button>
                                    <small className="backup-create-hint">Ao clicar, será aberta a janela para você escolher onde salvar o arquivo</small>
                                </div>
                            </section>

                            {backups.length === 0 ? (
                                <section className="stats-section backups-section">
                                    <div className="empty-state">
                                        <p>📁 Nenhum backup disponível ainda. Crie um para começar!</p>
                                    </div>
                                </section>
                            ) : (
                                <section className="stats-section backups-section">
                                    <h3>Backups Disponíveis</h3>
                                    <div className="backup-table-wrap">
                                        <table className="backup-table">
                                            <thead>
                                                <tr>
                                                    <th>Arquivo</th>
                                                    <th>Data/Hora</th>
                                                    <th>Tamanho</th>
                                                    <th>Ações</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {backups.map((backup) => (
                                                    <tr key={backup.filename}>
                                                        <td><code className="backup-filename">{backup.filename}</code></td>
                                                        <td>{formatDate(backup.createdAt)}</td>
                                                        <td>{Math.round(backup.size / 1024)} KB</td>
                                                        <td>
                                                            <button
                                                                type="button"
                                                                className="btn btn-small btn-info"
                                                                onClick={() => handleRestoreBackup(backup.filename)}
                                                                disabled={loadingBackups}
                                                            >
                                                                ↺ Restaurar
                                                            </button>
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                </section>
                            )}
                        </div>

                        <div className={`app-view ${activeView === 'inventory' ? 'active' : ''}`} data-view="inventory">
                            <section className="form-section">
                                <h2>Adicionar Produto</h2>
                                <form id="productForm" onSubmit={handleAddProduct}>
                                    <div className="form-group">
                                        <label htmlFor="productName">Nome do Produto:</label>
                                        <input id="productName" type="text" placeholder="Ex: Notebook" value={productForm.nome} onChange={(event) => setProductForm((current) => ({ ...current, nome: event.target.value }))} required />
                                    </div>

                                    <div className="form-group">
                                        <label htmlFor="productPatrimony">Nº de Patrimônio (opcional):</label>
                                        <input id="productPatrimony" type="text" placeholder="Ex: PAT-000123 (se houver)" value={productForm.patrimonio} onChange={(event) => setProductForm((current) => ({ ...current, patrimonio: event.target.value }))} />
                                    </div>

                                    <div className="form-group">
                                        <label htmlFor="productCategory">Categoria:</label>
                                        <select id="productCategory" value={productForm.categoria} onChange={(event) => setProductForm((current) => ({ ...current, categoria: event.target.value }))} required>
                                            <option value="">Selecione uma categoria</option>
                                            {PRODUCT_CATEGORIES.map((category) => (
                                                <option value={category} key={category}>{category}</option>
                                            ))}
                                        </select>
                                    </div>

                                    <div className="form-row">
                                        <div className="form-group">
                                            <label htmlFor="productQuantity">Quantidade:</label>
                                            <input id="productQuantity" type="number" min="1" value={productForm.quantidade} onChange={(event) => setProductForm((current) => ({ ...current, quantidade: event.target.value }))} required />
                                        </div>

                                        <div className="form-group">
                                            <label htmlFor="productPrice">Preço (R$):</label>
                                            <input id="productPrice" type="number" placeholder="0.00" step="0.01" min="0" value={productForm.preco} onChange={(event) => setProductForm((current) => ({ ...current, preco: event.target.value }))} required />
                                        </div>
                                    </div>

                                    <div className="form-group">
                                        <label htmlFor="productDescription">Descrição:</label>
                                        <textarea id="productDescription" placeholder="Descrição do produto (opcional)" rows="3" value={productForm.descricao} onChange={(event) => setProductForm((current) => ({ ...current, descricao: event.target.value }))}></textarea>
                                    </div>

                                    <button type="submit" className="btn btn-primary">Adicionar Produto</button>
                                </form>
                            </section>

                            <section className="filters-section">
                                <h2>Estoque</h2>
                                <div className="controls">
                                    <div className="search-box">
                                        <input type="text" id="searchInput" placeholder="🔍 Buscar por nome, patrimônio, descrição ou categoria..." value={search} onChange={(event) => setSearch(event.target.value)} />
                                    </div>

                                    <div className="filter-group">
                                        <select id="categoryFilter" value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}>
                                            <option value="">Todas as categorias</option>
                                            {PRODUCT_CATEGORIES.map((category) => (
                                                <option value={category} key={category}>{category}</option>
                                            ))}
                                        </select>
                                    </div>

                                    <select id="sortSelect" value={sortOption} onChange={(event) => setSortOption(event.target.value)}>
                                        <option value="name">Ordenar por Nome</option>
                                        <option value="quantity">Ordenar por Quantidade</option>
                                        <option value="price">Ordenar por Preço</option>
                                        <option value="category">Ordenar por Categoria</option>
                                    </select>
                                </div>
                            </section>

                            {lowStockProducts.length > 0 ? (
                                <section className="inventory-alert" role="alert" aria-live="polite">
                                    <div>
                                        <strong>Alerta de estoque mínimo:</strong>{' '}
                                        {lowStockProducts.length} produto(s) abaixo de {MIN_STOCK_THRESHOLD} unidades.
                                    </div>
                                    <div className="inventory-alert-meta">
                                        {lowStockProducts.slice(0, 5).map((item) => `${item.nome} (${item.quantidade})`).join(' • ')}
                                        {lowStockProducts.length > 5 ? ' • ...' : ''}
                                    </div>
                                    <div className="inventory-alert-actions">
                                        <button
                                            type="button"
                                            className="btn btn-secondary"
                                            onClick={() => setLowStockOnly((value) => !value)}
                                        >
                                            {lowStockOnly ? 'Mostrar todos' : 'Filtrar mínimos'}
                                        </button>
                                    </div>
                                </section>
                            ) : null}

                            <section className="stats-section">
                                <div className="stat-card">
                                    <h3>Total de Produtos</h3>
                                    <p id="totalProducts" className="stat-value">{products.length}</p>
                                </div>
                                <div className="stat-card">
                                    <h3>Valor Total</h3>
                                    <p id="totalValue" className="stat-value">{formatCurrency(products.reduce((sum, item) => sum + ((Number(item.quantidade) || 0) * (Number(item.preco) || 0)), 0))}</p>
                                </div>
                                <div className="stat-card">
                                    <h3>Itens em Estoque</h3>
                                    <p id="totalItems" className="stat-value">{products.reduce((sum, item) => sum + (Number(item.quantidade) || 0), 0)}</p>
                                </div>
                                <div className="stat-card">
                                    <h3>Produtos Baixos</h3>
                                    <p id="lowStockCount" className="stat-value">{lowStockProducts.length}</p>
                                </div>
                            </section>

                            <section className="products-section">
                                {loadingProducts ? <p className="empty-state">Carregando produtos...</p> : null}
                                <div id="productsList" className="products-list">
                                    {groupedInventoryCards.length === 0 ? null : groupedInventoryCards.map((group) => {
                                        const isExpanded = expandedCategory === group.key;
                                        const emBaixa = group.hasLowStock;
                                        const statusIcon = emBaixa ? '⚠️' : '✓';
                                        
                                        return (
                                            <div className={`category-section ${emBaixa ? 'low-stock' : ''}`} key={group.key}>
                                                <button
                                                    className={`category-header ${isExpanded ? 'expanded' : ''}`}
                                                    type="button"
                                                    onClick={() => setExpandedCategory(isExpanded ? null : group.key)}
                                                >
                                                    <div className="category-header-left">
                                                        <span className={`category-status ${emBaixa ? 'low' : 'normal'}`}>{statusIcon}</span>
                                                        <div className="category-info">
                                                            <span className="category-name">{group.nome}</span>
                                                            <span className="category-count">{group.items.length} {group.items.length === 1 ? 'item' : 'itens'}</span>
                                                        </div>
                                                    </div>
                                                    <div className="category-header-right">
                                                        <div className="category-stat category-stat-qty">
                                                            <span className="stat-label">Qtd</span>
                                                            <span className={`stat-value ${emBaixa ? 'low' : ''}`}>{group.totalQuantidade}</span>
                                                        </div>
                                                        <div className="category-stat category-stat-value">
                                                            <span className="stat-label">Valor</span>
                                                            <span className="stat-value">{formatCurrency(group.totalValor)}</span>
                                                        </div>
                                                        <div className="category-expand-icon">
                                                            {isExpanded ? '▼' : '▶'}
                                                        </div>
                                                    </div>
                                                </button>

                                                {isExpanded ? (
                                                    <div className="category-expanded">
                                                        {group.items.map((product, index) => {
                                                            const emBaixaProd = Number(product.quantidade) < MIN_STOCK_THRESHOLD;
                                                            return (
                                                                <div
                                                                    className={`product-item ${emBaixaProd ? 'low-stock' : ''} ${selectedProduct?.id === product.id ? 'selected' : ''}`}
                                                                    key={product.id}
                                                                    onClick={() => setSelectedProduct(product)}
                                                                >
                                                                    <div className="product-item-left">
                                                                        <span className="product-index">{index + 1}</span>
                                                                        <div className="product-item-info">
                                                                            <span className="product-item-name">{product.nome}</span>
                                                                            <span className="product-item-meta">
                                                                                {product.patrimonio || 'Sem patrimônio'} • {normalizeCategoryLabel(product.categoria)}
                                                                            </span>
                                                                        </div>
                                                                    </div>
                                                                    <div className="product-item-center">
                                                                        <span className="product-item-desc">
                                                                            {product.descricao ? String(product.descricao).substring(0, 60) : '-'}
                                                                        </span>
                                                                    </div>
                                                                    <div className="product-item-right">
                                                                        <div className="product-item-stat">
                                                                            <span className={`stat ${emBaixaProd ? 'low' : ''}`}>{Number(product.quantidade) || 0}</span>
                                                                            <span className="unit">un.</span>
                                                                        </div>
                                                                        <div className="product-item-stat">
                                                                            <span className="stat">{formatCurrency(product.preco)}</span>
                                                                        </div>
                                                                        <div className="product-item-actions">
                                                                            <button className="action-btn view" type="button" onClick={() => setDetailsProduct(product)} title="Ver detalhes">👁️</button>
                                                                            <button className="action-btn edit" type="button" onClick={() => setEditingProduct(product)} title="Editar">✏️</button>
                                                                            <button className="action-btn delete" type="button" onClick={() => handleDeleteProduct(product.id)} title="Deletar">🗑️</button>
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                            );
                                                        })}
                                                    </div>
                                                ) : null}
                                            </div>
                                        );
                                    })}
                                </div>
                                {groupedInventoryCards.length === 0 && !loadingProducts ? <div id="emptyState" className="empty-state"><p>📋 Nenhum produto cadastrado. Adicione um produto acima!</p></div> : null}
                            </section>
                        </div>
                    </main>

                    <footer>
                        <div className="export-menu" id="exportMenu" ref={exportMenuRef}>
                            <button id="exportMenuBtn" className="btn btn-secondary" type="button" onClick={() => setShowExportMenu((value) => !value)}>📤 Exportar Dados</button>
                            <div id="exportDropdown" className={`export-dropdown ${showExportMenu ? 'show' : ''}`}>
                                <button id="exportXlsxBtn" className="btn btn-secondary" type="button" onClick={handleExportXlsx}>📊 Exportar XLSX</button>
                                <button id="exportPdfBtn" className="btn btn-secondary" type="button" onClick={handleExportPdf}>🧾 Exportar PDF</button>
                            </div>
                        </div>
                        <button id="importBtn" className="btn btn-secondary" type="button" onClick={() => fileInputRef.current?.click()}>📤 Importar Arquivo</button>
                        <button id="clearBtn" className="btn btn-danger" type="button" onClick={handleClearAll}>🗑️ Limpar Tudo</button>
                        <input
                            type="file"
                            id="fileInput"
                            accept=".json,.xml,.pdf,.xlsx,.xls"
                            style={{ display: 'none' }}
                            ref={fileInputRef}
                            onChange={handleImportFile}
                        />
                    </footer>
                </div>
            )}

            {editingProduct ? (
                <Modal
                    title="Editar Produto"
                    onClose={() => setEditingProduct(null)}
                    footer={(
                        <>
                            <button type="button" className="btn btn-primary" onClick={handleSaveEdit}>Salvar Alterações</button>
                            <button type="button" className="btn btn-secondary" onClick={() => setEditingProduct(null)}>Cancelar</button>
                        </>
                    )}
                >
                    <form id="editForm" onSubmit={handleSaveEdit}>
                        <div className="form-group">
                            <label htmlFor="editProductName">Nome:</label>
                            <input id="editProductName" type="text" value={editForm.nome} onChange={(event) => setEditForm((current) => ({ ...current, nome: event.target.value }))} required />
                        </div>

                        <div className="form-group">
                            <label htmlFor="editProductPatrimony">Nº de Patrimônio (opcional):</label>
                            <input id="editProductPatrimony" type="text" value={editForm.patrimonio} onChange={(event) => setEditForm((current) => ({ ...current, patrimonio: event.target.value }))} />
                        </div>

                        <div className="form-group">
                            <label htmlFor="editProductCategory">Categoria:</label>
                            <select id="editProductCategory" value={editForm.categoria} onChange={(event) => setEditForm((current) => ({ ...current, categoria: event.target.value }))} required>
                                {PRODUCT_CATEGORIES.map((category) => (
                                    <option value={category} key={category}>{category}</option>
                                ))}
                            </select>
                        </div>

                        <div className="form-row">
                            <div className="form-group">
                                <label htmlFor="editProductQuantity">Quantidade:</label>
                                <input id="editProductQuantity" type="number" min="0" value={editForm.quantidade} onChange={(event) => setEditForm((current) => ({ ...current, quantidade: event.target.value }))} required />
                            </div>
                            <div className="form-group">
                                <label htmlFor="editProductPrice">Preço (R$):</label>
                                <input id="editProductPrice" type="number" step="0.01" min="0" value={editForm.preco} onChange={(event) => setEditForm((current) => ({ ...current, preco: event.target.value }))} required />
                            </div>
                        </div>

                        <div className="form-group">
                            <label htmlFor="editProductDescription">Descrição:</label>
                            <textarea id="editProductDescription" rows="3" value={editForm.descricao} onChange={(event) => setEditForm((current) => ({ ...current, descricao: event.target.value }))}></textarea>
                        </div>
                    </form>
                </Modal>
            ) : null}

            {detailsProduct ? (
                <Modal title={null} onClose={() => setDetailsProduct(null)} footer={(
                    <button type="button" className="btn btn-primary" onClick={() => setDetailsProduct(null)}>Fechar</button>
                )}>
                    <div id="productDetails">
                        <h2>{detailsProduct.nome}</h2>
                        <div style={{ display: 'grid', gap: '15px', marginTop: '20px' }}>
                            <div className="info-item">
                                <div className="info-label">Categoria</div>
                                    <div className={`product-category ${getCategoryClassName(normalizeCategoryLabel(detailsProduct.categoria))}`} style={{ display: 'inline-block' }}>{normalizeCategoryLabel(detailsProduct.categoria)}</div>
                            </div>
                            <div className="info-item">
                                <div className="info-label">Nº de Patrimônio</div>
                                <div>{detailsProduct.patrimonio || 'Sem patrimônio'}</div>
                            </div>
                            <div className="info-item">
                                <div className="info-label">Descrição</div>
                                <div>{detailsProduct.descricao || 'Sem descrição'}</div>
                            </div>
                            <div className="info-item">
                                <div className="info-label">Quantidade em Estoque</div>
                                <div className="info-value quantity">{detailsProduct.quantidade} unidades</div>
                            </div>
                            <div className="info-item">
                                <div className="info-label">Preço Unitário</div>
                                <div className="info-value price">{formatCurrency(detailsProduct.preco)}</div>
                            </div>
                            <div className="info-item">
                                <div className="info-label">Valor Total em Estoque</div>
                                <div className="info-value price">{formatCurrency((Number(detailsProduct.quantidade) || 0) * (Number(detailsProduct.preco) || 0))}</div>
                            </div>
                            <div className="info-item">
                                <div className="info-label">Criado em</div>
                                <div>{formatDate(detailsProduct.dataCriacao)}</div>
                            </div>
                            <div className="info-item">
                                <div className="info-label">Atualizado em</div>
                                <div>{formatDate(detailsProduct.dataAtualizacao)}</div>
                            </div>
                        </div>
                    </div>
                </Modal>
            ) : null}

            {showProfilePhotoModal ? (
                <Modal
                    title="Foto do usuário"
                    onClose={closeProfilePhotoModal}
                    footer={(
                        <>
                            <button type="button" className="btn btn-secondary" onClick={() => profilePhotoInputRef.current?.click()}>Trocar foto</button>
                            <button
                                type="button"
                                className="btn btn-danger"
                                onClick={() => setProfilePhotoDraft({ ...DEFAULT_PROFILE_PHOTO_CONFIG })}
                                disabled={!profilePhotoDraft.src}
                            >
                                Remover
                            </button>
                            <button type="button" className="btn btn-primary" onClick={handleSaveProfilePhotoAdjustments}>Salvar</button>
                        </>
                    )}
                >
                    <div className="profile-photo-modal-content">
                        <div className="profile-photo-preview-box">
                            {profilePhotoDraft.src ? (
                                <img
                                    src={profilePhotoDraft.src}
                                    alt="Pré-visualização da foto"
                                    className="profile-photo-preview-image"
                                    style={getProfilePhotoStyle(profilePhotoDraft)}
                                />
                            ) : (
                                <div className="profile-photo-preview-placeholder">Sem foto selecionada</div>
                            )}
                        </div>

                        <div className="profile-photo-controls">
                            <p className="auth-hint" style={{ margin: 0, color: '#334155' }}>
                                Tamanho máximo da imagem: 4MB.
                            </p>
                            <label htmlFor="profilePhotoZoom">Zoom</label>
                            <input
                                id="profilePhotoZoom"
                                type="range"
                                min="1"
                                max="2.5"
                                step="0.05"
                                value={profilePhotoDraft.zoom}
                                disabled={!profilePhotoDraft.src}
                                onChange={(event) => setProfilePhotoDraft((current) => ({ ...current, zoom: Number(event.target.value) || 1 }))}
                            />

                            <label htmlFor="profilePhotoOffsetX">Posição horizontal</label>
                            <input
                                id="profilePhotoOffsetX"
                                type="range"
                                min="-35"
                                max="35"
                                step="1"
                                value={profilePhotoDraft.offsetX}
                                disabled={!profilePhotoDraft.src}
                                onChange={(event) => setProfilePhotoDraft((current) => ({ ...current, offsetX: Number(event.target.value) || 0 }))}
                            />

                            <label htmlFor="profilePhotoOffsetY">Posição vertical</label>
                            <input
                                id="profilePhotoOffsetY"
                                type="range"
                                min="-35"
                                max="35"
                                step="1"
                                value={profilePhotoDraft.offsetY}
                                disabled={!profilePhotoDraft.src}
                                onChange={(event) => setProfilePhotoDraft((current) => ({ ...current, offsetY: Number(event.target.value) || 0 }))}
                            />
                        </div>
                    </div>
                </Modal>
            ) : null}
        </>
    );
}

try {
    const mountNode = document.getElementById('root');
    if (!mountNode) {
        throw new Error('Elemento #root não encontrado.');
    }

    const root = ReactDOM.createRoot(mountNode);
    root.render(<App />);
} catch (error) {
    const mountNode = document.getElementById('root');
    if (mountNode) {
        mountNode.innerHTML = `
            <div style="max-width:760px;margin:24px auto;padding:20px;border-radius:12px;background:#fee2e2;color:#7f1d1d;border:1px solid #fecaca;font-family:Inter,sans-serif;">
                <h2 style="margin:0 0 10px 0;">Erro ao iniciar a interface</h2>
                <pre style="white-space:pre-wrap;word-break:break-word;margin:0;background:#fff7ed;padding:10px;border-radius:8px;border:1px solid #fed7aa;">${String((error && (error.stack || error.message)) || error)}</pre>
            </div>
        `;
    }
    console.error('Falha ao montar App:', error);
}
