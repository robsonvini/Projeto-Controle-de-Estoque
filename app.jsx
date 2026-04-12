const { useEffect, useMemo, useRef, useState } = React;

const PRODUCT_CATEGORIES = ['Eletrônicos', 'Alimentos', 'Roupas', 'Higiene', 'Outros'];
const PRODUCT_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ef4444', '#14b8a6'];
const MIN_STOCK_THRESHOLD = 2;
const SESSION_KEY = 'estoqueSession';
const SESSION_30_MIN = 30 * 60 * 1000;
const SESSION_24_HOURS = 24 * 60 * 60 * 1000;

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
        dateStyle: 'short',
        timeStyle: 'short'
    }).format(parsed);
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

function computeDashboard(products, period) {
    const filtered = filterByPeriod(products, period);
    const totalProdutos = filtered.length;
    const totalItens = filtered.reduce((sum, item) => sum + (Number(item.quantidade) || 0), 0);
    const totalValor = filtered.reduce((sum, item) => sum + ((Number(item.quantidade) || 0) * (Number(item.preco) || 0)), 0);
    const produtosBaixos = filtered.filter((item) => Number(item.quantidade) < MIN_STOCK_THRESHOLD).length;
    const categorias = {};

    filtered.forEach((produto) => {
        const categoria = produto.categoria || 'Outros';
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

function DashboardCharts({ visible, data }) {
    const categoryRef = useRef(null);
    const statusRef = useRef(null);
    const chartsRef = useRef({ category: null, status: null });

    useEffect(() => {
        if (!visible || !window.Chart || !categoryRef.current || !statusRef.current) return undefined;

        const categoryEntries = Object.entries(data.categorias).sort((a, b) => b[1].quantidade - a[1].quantidade);
        const categoryLabels = categoryEntries.length ? categoryEntries.map(([name]) => name) : ['Sem dados'];
        const categoryValues = categoryEntries.length ? categoryEntries.map(([, info]) => info.quantidade) : [1];
        const stockValues = [Math.max(data.totalProdutos - data.produtosBaixos, 0), data.produtosBaixos];

        if (chartsRef.current.category) chartsRef.current.category.destroy();
        if (chartsRef.current.status) chartsRef.current.status.destroy();

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
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { position: 'bottom' }
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
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { position: 'bottom' }
                }
            }
        });

        return () => {
            if (chartsRef.current.category) chartsRef.current.category.destroy();
            if (chartsRef.current.status) chartsRef.current.status.destroy();
        };
    }, [visible, data]);

    return (
        <div className="dashboard-grid">
            <div className="chart-card">
                <div className="section-heading compact">
                    <h3>Participação por categoria</h3>
                    <p>Percentual de itens por categoria sobre o total do estoque.</p>
                </div>
                <canvas ref={categoryRef} height="260"></canvas>
            </div>
            <div className="chart-card">
                <div className="section-heading compact">
                    <h3>Status do estoque</h3>
                    <p>Distribuição percentual entre estoque saudável e estoque baixo.</p>
                </div>
                <canvas ref={statusRef} height="260"></canvas>
            </div>
        </div>
    );
}

function App() {
    const api = useRef(new ApiClient()).current;
    const fileInputRef = useRef(null);
    const exportMenuRef = useRef(null);
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
    const [activeView, setActiveView] = useState('inventory');
    const [dashboardPeriod, setDashboardPeriod] = useState('all');
    const [showExportMenu, setShowExportMenu] = useState(false);
    const [lowStockOnly, setLowStockOnly] = useState(false);
    const [search, setSearch] = useState('');
    const [categoryFilter, setCategoryFilter] = useState('');
    const [sortOption, setSortOption] = useState('name');
    const [productForm, setProductForm] = useState({
        nome: '',
        categoria: '',
        quantidade: 1,
        preco: '',
        descricao: ''
    });
    const [editForm, setEditForm] = useState({
        nome: '',
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
    const [movementForm, setMovementForm] = useState({
        productId: '',
        type: 'entrada',
        quantity: 1,
        reason: ''
    });
    const [movementFilter, setMovementFilter] = useState({ productId: '', type: '', period: 'all', order: 'recent' });

    const showApp = Boolean(token && session && session.expiraEm && Date.now() < session.expiraEm);

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

        const storedSession = (() => {
            try {
                const raw = localStorage.getItem(SESSION_KEY);
                return raw ? JSON.parse(raw) : null;
            } catch {
                return null;
            }
        })();

        if (!api.token || !storedSession || !storedSession.expiraEm || Date.now() > storedSession.expiraEm) {
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
        const handleOutsideClick = (event) => {
            if (exportMenuRef.current && !exportMenuRef.current.contains(event.target)) {
                setShowExportMenu(false);
            }
        };

        document.addEventListener('click', handleOutsideClick);
        return () => document.removeEventListener('click', handleOutsideClick);
    }, []);

    useEffect(() => {
        if (editingProduct) {
            setEditForm({
                nome: editingProduct.nome || '',
                categoria: editingProduct.categoria || 'Eletrônicos',
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
            setMovementForm((current) => ({ ...current, productId: '' }));
            return;
        }

        setMovementForm((current) => {
            if (current.productId && products.some((item) => String(item.id) === String(current.productId))) {
                return current;
            }

            return {
                ...current,
                productId: String(products[0].id)
            };
        });
    }, [products]);

    const filteredProducts = useMemo(() => {
        let list = [...products];
        const query = search.trim().toLowerCase();

        if (query) {
            list = list.filter((product) => (
                product.nome?.toLowerCase().includes(query) ||
                (product.descricao || '').toLowerCase().includes(query) ||
                product.categoria?.toLowerCase().includes(query)
            ));
        }

        if (categoryFilter) {
            list = list.filter((product) => product.categoria === categoryFilter);
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

    const lowStockProducts = useMemo(
        () => products.filter((item) => (Number(item.quantidade) || 0) < MIN_STOCK_THRESHOLD),
        [products]
    );

    const filteredMovements = useMemo(() => {
        let list = [...movements];

        if (movementFilter.productId) {
            list = list.filter((item) => String(item.productId) === String(movementFilter.productId));
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
    }, [movements, movementFilter]);

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
                expiraEm
            };

            localStorage.setItem(SESSION_KEY, JSON.stringify(nextSession));
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

    async function handleCreateMovement(event) {
        event.preventDefault();

        const productId = Number(movementForm.productId);
        const payload = {
            type: movementForm.type,
            quantity: Number(movementForm.quantity),
            reason: movementForm.reason.trim()
        };

        if (!productId || !payload.type || payload.quantity < 1 || !payload.reason) {
            notify('Preencha os dados da movimentação corretamente.', 'error');
            return;
        }

        try {
            const result = await api.createMovement(productId, payload);
            setProducts((current) => current.map((item) => (item.id === result.product.id ? result.product : item)));
            setMovements((current) => [result.movement, ...current]);
            setMovementForm((current) => ({ ...current, quantity: 1, reason: '' }));
            notify('Movimentação registrada com sucesso!', 'success');
        } catch (error) {
            if (error.status === 401) {
                handleLogout('Sessão expirada. Entre novamente.');
                return;
            }
            notify(error.message || 'Não foi possível registrar a movimentação.', 'error');
        }
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
            setProductForm({ nome: '', categoria: '', quantidade: 1, preco: '', descricao: '' });
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
            categoria: editForm.categoria,
            quantidade: Number(editForm.quantidade),
            preco: Number(editForm.preco),
            descricao: editForm.descricao.trim()
        };

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
            } else if (extension === 'xlsx' || extension === 'xls' || extension === 'pdf') {
                await api.importFile(file);
            } else {
                throw new Error('Formato não suportado. Use JSON, XML, XLSX ou PDF.');
            }

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

    function togglePassword(key) {
        setShowPasswords((current) => ({ ...current, [key]: !current[key] }));
    }

    function setAuthMessage(type, text) {
        setAuthFeedback({ type, text });
    }

    if (!bootstrapped) {
        return (
            <div className="auth-shell">
                <div className="auth-card">
                    <div className="auth-panel" style={{ minHeight: '320px', display: 'grid', placeItems: 'center' }}>
                        <p className="auth-hint">Carregando aplicação...</p>
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
                            <span id="loggedUserText">{sessionUser ? `${sessionUser.name || sessionUser.email} · ${sessionUser.email}` : ''}</span>
                            <button id="logoutBtn" className="btn btn-secondary" type="button" onClick={() => handleLogout('Sessão encerrada com sucesso.')}>Sair</button>
                        </div>
                        <div className="view-tabs">
                            <button id="inventoryViewBtn" className={`view-tab ${activeView === 'inventory' ? 'active' : ''}`} type="button" onClick={() => setActiveView('inventory')}>Estoque</button>
                            <button id="movementsViewBtn" className={`view-tab ${activeView === 'movements' ? 'active' : ''}`} type="button" onClick={() => setActiveView('movements')}>Movimentações</button>
                            <button id="dashboardViewBtn" className={`view-tab ${activeView === 'dashboard' ? 'active' : ''}`} type="button" onClick={() => setActiveView('dashboard')}>Dashboard</button>
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

                            <DashboardCharts visible={activeView === 'dashboard'} data={dashboardData} />

                            <div className="dashboard-breakdown">
                                <h3>Detalhamento percentual por categoria</h3>
                                <div id="categoryPercentList" className="category-percent-list">
                                    {categoryEntries.length === 0 ? (
                                        <p className="empty-state">Nenhuma categoria para exibir ainda.</p>
                                    ) : (
                                        categoryEntries
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
                                            <label htmlFor="movementProduct">Produto</label>
                                            <select
                                                id="movementProduct"
                                                value={movementForm.productId}
                                                onChange={(event) => setMovementForm((current) => ({ ...current, productId: event.target.value }))}
                                                required
                                            >
                                                {products.length === 0 ? <option value="">Nenhum produto disponível</option> : null}
                                                {products.map((product) => (
                                                    <option value={String(product.id)} key={product.id}>
                                                        {product.nome} (estoque: {Number(product.quantidade) || 0})
                                                    </option>
                                                ))}
                                            </select>
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
                                                    min="1"
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
                                                {products.map((product) => (
                                                    <option value={String(product.id)} key={`filter_${product.id}`}>{product.nome}</option>
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
                                                onClick={() => setMovementFilter({ productId: '', type: '', period: 'all', order: 'recent' })}
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
                                                    <th>Data</th>
                                                    <th>Produto</th>
                                                    <th>Tipo</th>
                                                    <th>Qtd</th>
                                                    <th>Saldo</th>
                                                    <th>Motivo</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {filteredMovements.length === 0 && !loadingMovements ? (
                                                    <tr>
                                                        <td colSpan="6" className="movement-empty">Nenhuma movimentação registrada.</td>
                                                    </tr>
                                                ) : null}
                                                {filteredMovements.map((movement) => (
                                                    <tr key={movement.id}>
                                                        <td>{formatDate(movement.createdAt)}</td>
                                                        <td>{movement.productName}</td>
                                                        <td>
                                                            <span className={`movement-badge ${movement.type === 'entrada' ? 'entry' : 'exit'}`}>
                                                                {movement.type === 'entrada' ? '▲ Entrada' : '▼ Saída'}
                                                            </span>
                                                        </td>
                                                        <td>{movement.quantity}</td>
                                                        <td>{movement.previousStock} → {movement.newStock}</td>
                                                        <td>{movement.reason}</td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                </section>
                            </section>
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
                                        <input type="text" id="searchInput" placeholder="🔍 Buscar produto..." value={search} onChange={(event) => setSearch(event.target.value)} />
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
                                <div id="productsList" className="products-grid">
                                    {filteredProducts.length === 0 ? null : filteredProducts.map((product) => {
                                        const emBaixa = Number(product.quantidade) < MIN_STOCK_THRESHOLD;
                                        return (
                                            <div className={`product-card ${emBaixa ? 'low-stock' : ''}`} key={product.id} data-id={product.id} onClick={() => setDetailsProduct(product)}>
                                                <div className="product-header">
                                                    <span className="product-name">{product.nome}</span>
                                                    <span className={`product-category ${product.categoria}`}>{product.categoria}</span>
                                                </div>
                                                {product.descricao ? <p className="product-description">{String(product.descricao).substring(0, 100)}</p> : null}
                                                <div className="product-info">
                                                    <div className="info-item">
                                                        <div className="info-label">Quantidade</div>
                                                        <div className={`info-value quantity ${emBaixa ? 'low' : ''}`}>{product.quantidade}</div>
                                                    </div>
                                                    <div className="info-item">
                                                        <div className="info-label">Preço</div>
                                                        <div className="info-value price">{formatCurrency(product.preco)}</div>
                                                    </div>
                                                </div>
                                                <div className="product-actions">
                                                    <button className="btn btn-small btn-info" type="button" onClick={(event) => { event.stopPropagation(); setDetailsProduct(product); }}>Ver</button>
                                                    <button className="btn btn-small btn-edit" type="button" onClick={(event) => { event.stopPropagation(); setEditingProduct(product); }}>Editar</button>
                                                    <button className="btn btn-small btn-delete" type="button" onClick={(event) => { event.stopPropagation(); handleDeleteProduct(product.id); }}>Deletar</button>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                                {filteredProducts.length === 0 && !loadingProducts ? <div id="emptyState" className="empty-state"><p>📋 Nenhum produto cadastrado. Adicione um produto acima!</p></div> : null}
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
                                <div className={`product-category ${detailsProduct.categoria}`} style={{ display: 'inline-block' }}>{detailsProduct.categoria}</div>
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
                                <div className="info-label">Data de Criação</div>
                                <div>{formatDate(detailsProduct.dataCriacao)}</div>
                            </div>
                            <div className="info-item">
                                <div className="info-label">Última Atualização</div>
                                <div>{formatDate(detailsProduct.dataAtualizacao)}</div>
                            </div>
                        </div>
                    </div>
                </Modal>
            ) : null}
        </>
    );
}

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<App />);
