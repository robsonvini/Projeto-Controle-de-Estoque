// Sistema de Controle de Estoque integrado com API backend

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
        const headers = {
            ...(options.headers || {})
        };

        if (!(options.body instanceof FormData) && !headers['Content-Type']) {
            headers['Content-Type'] = 'application/json';
        }

        if (requireAuth) {
            if (!this.token) {
                throw new Error('Sessao expirada. Faca login novamente.');
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
            const message = isJson && payload?.error ? payload.error : 'Erro na comunicacao com a API.';
            const error = new Error(message);
            error.status = response.status;
            throw error;
        }

        return payload;
    }

    async health() {
        return this.request('/health');
    }

    async register(data) {
        return this.request('/auth/register', {
            method: 'POST',
            body: JSON.stringify(data)
        });
    }

    async login(data) {
        return this.request('/auth/login', {
            method: 'POST',
            body: JSON.stringify(data)
        });
    }

    async recover(data) {
        return this.request('/auth/recover', {
            method: 'POST',
            body: JSON.stringify(data)
        });
    }

    async getProducts() {
        return this.request('/products', { method: 'GET' }, true);
    }

    async createProduct(product) {
        return this.request('/products', {
            method: 'POST',
            body: JSON.stringify(product)
        }, true);
    }

    async updateProduct(id, product) {
        return this.request(`/products/${id}`, {
            method: 'PUT',
            body: JSON.stringify(product)
        }, true);
    }

    async deleteProduct(id) {
        return this.request(`/products/${id}`, { method: 'DELETE' }, true);
    }

    async importProducts(products) {
        return this.request('/products/import', {
            method: 'POST',
            body: JSON.stringify({ products })
        }, true);
    }

    async importXml(xml) {
        return this.request('/products/import/xml', {
            method: 'POST',
            body: JSON.stringify({ xml })
        }, true);
    }

    async importFile(file) {
        const formData = new FormData();
        formData.append('file', file);

        return this.request('/products/import/file', {
            method: 'POST',
            body: formData,
            headers: {}
        }, true);
    }

    async download(path, filename) {
        if (!this.token) {
            throw new Error('Sessao expirada. Faca login novamente.');
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

class EstoqueManager {
    constructor(apiClient, authManager) {
        this.api = apiClient;
        this.authManager = authManager;
        this.produtos = [];
        this.editar_id = null;
        this.activeView = 'inventory';
        this.dashboardPeriod = 'all';
        this.dashboardCharts = {
            category: null,
            status: null
        };
        this.init();
    }

    async init() {
        this.addEventListeners();
        await this.carregarProdutos();
        this.showView('inventory');
    }

    addEventListeners() {
        const exportMenuBtn = document.getElementById('exportMenuBtn');
        const exportDropdown = document.getElementById('exportDropdown');
        const exportXlsxBtn = document.getElementById('exportXlsxBtn');
        const exportPdfBtn = document.getElementById('exportPdfBtn');
        const inventoryViewBtn = document.getElementById('inventoryViewBtn');
        const dashboardViewBtn = document.getElementById('dashboardViewBtn');
        const dashboardPeriodSelect = document.getElementById('dashboardPeriodSelect');

        document.getElementById('productForm').addEventListener('submit', (e) => {
            e.preventDefault();
            this.adicionarProduto();
        });

        document.getElementById('searchInput').addEventListener('input', () => {
            this.renderizar();
        });

        document.getElementById('categoryFilter').addEventListener('change', () => {
            this.renderizar();
        });

        document.getElementById('sortSelect').addEventListener('change', () => {
            this.renderizar();
        });

        document.querySelector('.close').addEventListener('click', () => {
            this.fecharModal('editModal');
        });

        document.getElementById('cancelEdit').addEventListener('click', () => {
            this.fecharModal('editModal');
        });

        document.getElementById('editForm').addEventListener('submit', (e) => {
            e.preventDefault();
            this.salvarEdicao();
        });

        document.querySelectorAll('.modal .close').forEach(btn => {
            btn.addEventListener('click', (e) => {
                if (e.target.closest('#editModal .close')) return;
                this.fecharModal('detailsModal');
            });
        });

        inventoryViewBtn.addEventListener('click', () => this.showView('inventory'));
        dashboardViewBtn.addEventListener('click', () => this.showView('dashboard'));
        dashboardPeriodSelect.addEventListener('change', (e) => {
            this.dashboardPeriod = e.target.value;
            this.atualizarDashboard();
        });

        exportMenuBtn.addEventListener('click', () => {
            exportDropdown.classList.toggle('show');
        });

        exportXlsxBtn.addEventListener('click', () => {
            exportDropdown.classList.remove('show');
            this.exportarXLSX();
        });

        exportPdfBtn.addEventListener('click', () => {
            exportDropdown.classList.remove('show');
            this.exportarPDF();
        });

        document.getElementById('importBtn').addEventListener('click', () => {
            document.getElementById('fileInput').click();
        });

        document.getElementById('fileInput').addEventListener('change', (e) => {
            this.importarDados(e);
        });

        document.getElementById('clearBtn').addEventListener('click', () => {
            if (confirm('Tem certeza que deseja limpar todos os dados? Esta acao nao pode ser desfeita!')) {
                this.limparTudo();
            }
        });

        window.addEventListener('click', (e) => {
            const editModal = document.getElementById('editModal');
            const detailsModal = document.getElementById('detailsModal');
            const exportMenu = document.getElementById('exportMenu');
            if (e.target === editModal) this.fecharModal('editModal');
            if (e.target === detailsModal) this.fecharModal('detailsModal');
            if (exportMenu && !exportMenu.contains(e.target)) {
                exportDropdown.classList.remove('show');
            }
        });

        window.addEventListener('resize', () => {
            if (this.activeView === 'dashboard') {
                this.redimensionarDashboard();
            }
        });
    }

    async carregarProdutos() {
        try {
            this.produtos = await this.api.getProducts();
            this.renderizar();
            this.atualizarEstatisticas();
        } catch (error) {
            this.tratarErroApi(error, 'Erro ao carregar produtos.');
        }
    }

    async adicionarProduto() {
        const form = document.getElementById('productForm');

        const produto = {
            nome: document.getElementById('productName').value.trim(),
            categoria: document.getElementById('productCategory').value,
            quantidade: parseInt(document.getElementById('productQuantity').value, 10),
            preco: parseFloat(document.getElementById('productPrice').value),
            descricao: document.getElementById('productDescription').value.trim()
        };

        if (!produto.nome || produto.quantidade < 1 || produto.preco < 0) {
            alert('Preencha os campos obrigatorios corretamente.');
            return;
        }

        try {
            const criado = await this.api.createProduct(produto);
            this.produtos.push(criado);
            form.reset();
            this.renderizar();
            this.atualizarEstatisticas();
            this.mostrarNotificacao('Produto adicionado com sucesso!', 'success');
        } catch (error) {
            this.tratarErroApi(error, 'Nao foi possivel adicionar o produto.');
        }
    }

    editarProduto(id) {
        const produto = this.produtos.find(p => p.id === id);
        if (!produto) return;

        this.editar_id = id;
        document.getElementById('editProductName').value = produto.nome;
        document.getElementById('editProductCategory').value = produto.categoria;
        document.getElementById('editProductQuantity').value = produto.quantidade;
        document.getElementById('editProductPrice').value = produto.preco;
        document.getElementById('editProductDescription').value = produto.descricao;

        this.abrirModal('editModal');
    }

    async salvarEdicao() {
        const produto = this.produtos.find(p => p.id === this.editar_id);
        if (!produto) return;

        const payload = {
            ...produto,
            nome: document.getElementById('editProductName').value.trim(),
            categoria: document.getElementById('editProductCategory').value,
            quantidade: parseInt(document.getElementById('editProductQuantity').value, 10),
            preco: parseFloat(document.getElementById('editProductPrice').value),
            descricao: document.getElementById('editProductDescription').value.trim()
        };

        try {
            const atualizado = await this.api.updateProduct(this.editar_id, payload);
            const index = this.produtos.findIndex(p => p.id === this.editar_id);
            if (index !== -1) this.produtos[index] = atualizado;

            this.fecharModal('editModal');
            this.renderizar();
            this.atualizarEstatisticas();
            this.mostrarNotificacao('Produto atualizado com sucesso!', 'success');
        } catch (error) {
            this.tratarErroApi(error, 'Nao foi possivel salvar a edicao.');
        }
    }

    async deletarProduto(id) {
        if (!confirm('Tem certeza que deseja deletar este produto?')) return;

        try {
            await this.api.deleteProduct(id);
            this.produtos = this.produtos.filter(p => p.id !== id);
            this.renderizar();
            this.atualizarEstatisticas();
            this.mostrarNotificacao('Produto deletado com sucesso!', 'success');
        } catch (error) {
            this.tratarErroApi(error, 'Nao foi possivel deletar o produto.');
        }
    }

    renderizar() {
        const filteredProducts = this.filtrarEOrdenar();
        const productsList = document.getElementById('productsList');
        const emptyState = document.getElementById('emptyState');

        if (filteredProducts.length === 0) {
            productsList.innerHTML = '';
            emptyState.style.display = 'block';
            return;
        }

        emptyState.style.display = 'none';
        productsList.innerHTML = filteredProducts.map(produto => this.criarCardProduto(produto)).join('');

        document.querySelectorAll('.btn-edit').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.editarProduto(parseInt(btn.dataset.id, 10));
            });
        });

        document.querySelectorAll('.btn-delete').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.deletarProduto(parseInt(btn.dataset.id, 10));
            });
        });

        document.querySelectorAll('.btn-info').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.mostrarDetalhes(parseInt(btn.dataset.id, 10));
            });
        });

        document.querySelectorAll('.product-card').forEach(card => {
            card.addEventListener('click', () => {
                this.mostrarDetalhes(parseInt(card.dataset.id, 10));
            });
        });
    }

    criarCardProduto(produto) {
        const emBaixa = produto.quantidade < 10;
        const estilo = emBaixa ? 'low-stock' : '';
        const classQuantidade = emBaixa ? 'low' : '';

        return `
            <div class="product-card ${estilo}" data-id="${produto.id}">
                <div class="product-header">
                    <span class="product-name">${this.escaparHTML(produto.nome)}</span>
                    <span class="product-category ${produto.categoria}">${produto.categoria}</span>
                </div>
                ${produto.descricao ? `<p class="product-description">${this.escaparHTML(produto.descricao.substring(0, 100))}</p>` : ''}
                <div class="product-info">
                    <div class="info-item">
                        <div class="info-label">Quantidade</div>
                        <div class="info-value quantity ${classQuantidade}">${produto.quantidade}</div>
                    </div>
                    <div class="info-item">
                        <div class="info-label">Preco</div>
                        <div class="info-value price">R$ ${Number(produto.preco).toFixed(2)}</div>
                    </div>
                </div>
                <div class="product-actions">
                    <button class="btn btn-small btn-info" data-id="${produto.id}">Ver</button>
                    <button class="btn btn-small btn-edit" data-id="${produto.id}">Editar</button>
                    <button class="btn btn-small btn-delete" data-id="${produto.id}">Deletar</button>
                </div>
            </div>
        `;
    }

    mostrarDetalhes(id) {
        const produto = this.produtos.find(p => p.id === id);
        if (!produto) return;

        const detailsContent = document.getElementById('productDetails');
        const valorTotal = (produto.quantidade * produto.preco).toFixed(2);

        detailsContent.innerHTML = `
            <h2>${this.escaparHTML(produto.nome)}</h2>
            <div style="display: grid; gap: 15px; margin-top: 20px;">
                <div class="info-item">
                    <div class="info-label">Categoria</div>
                    <div class="product-category ${produto.categoria}" style="display: inline-block;">${produto.categoria}</div>
                </div>
                <div class="info-item">
                    <div class="info-label">Descricao</div>
                    <div>${this.escaparHTML(produto.descricao || 'Sem descricao')}</div>
                </div>
                <div class="info-item">
                    <div class="info-label">Quantidade em Estoque</div>
                    <div class="info-value quantity">${produto.quantidade} unidades</div>
                </div>
                <div class="info-item">
                    <div class="info-label">Preco Unitario</div>
                    <div class="info-value price">R$ ${Number(produto.preco).toFixed(2)}</div>
                </div>
                <div class="info-item">
                    <div class="info-label">Valor Total em Estoque</div>
                    <div class="info-value price">R$ ${valorTotal}</div>
                </div>
                <div class="info-item">
                    <div class="info-label">Data de Criacao</div>
                    <div>${produto.dataCriacao}</div>
                </div>
                <div class="info-item">
                    <div class="info-label">Ultima Atualizacao</div>
                    <div>${produto.dataAtualizacao}</div>
                </div>
            </div>
            <div class="modal-actions">
                <button class="btn btn-primary" id="closeDetailsBtn">Fechar</button>
            </div>
        `;

        this.abrirModal('detailsModal');

        document.getElementById('closeDetailsBtn').addEventListener('click', () => {
            this.fecharModal('detailsModal');
        });
    }

    filtrarEOrdenar() {
        let produtos = [...this.produtos];

        const search = document.getElementById('searchInput').value.toLowerCase();
        if (search) {
            produtos = produtos.filter(p =>
                p.nome.toLowerCase().includes(search) ||
                (p.descricao || '').toLowerCase().includes(search) ||
                p.categoria.toLowerCase().includes(search)
            );
        }

        const categoria = document.getElementById('categoryFilter').value;
        if (categoria) {
            produtos = produtos.filter(p => p.categoria === categoria);
        }

        const sort = document.getElementById('sortSelect').value;
        switch (sort) {
            case 'name':
                produtos.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
                break;
            case 'quantity':
                produtos.sort((a, b) => a.quantidade - b.quantidade);
                break;
            case 'price':
                produtos.sort((a, b) => a.preco - b.preco);
                break;
            case 'category':
                produtos.sort((a, b) => a.categoria.localeCompare(b.categoria, 'pt-BR'));
                break;
            default:
                break;
        }

        return produtos;
    }

    atualizarEstatisticas() {
        const totalProdutos = this.produtos.length;
        const totalItens = this.produtos.reduce((sum, p) => sum + Number(p.quantidade), 0);
        const valorTotal = this.produtos.reduce((sum, p) => sum + (Number(p.quantidade) * Number(p.preco)), 0);
        const produtosBaixos = this.produtos.filter(p => Number(p.quantidade) < 10).length;

        document.getElementById('totalProducts').textContent = totalProdutos;
        document.getElementById('totalItems').textContent = totalItens;
        document.getElementById('totalValue').textContent = 'R$ ' + valorTotal.toFixed(2);
        document.getElementById('lowStockCount').textContent = produtosBaixos;

        this.atualizarDashboard();
    }

    showView(view) {
        this.activeView = view;

        document.querySelectorAll('.view-tab').forEach((btn) => {
            btn.classList.toggle('active', btn.id === `${view}ViewBtn`);
        });

        document.querySelectorAll('.app-view').forEach((section) => {
            section.classList.toggle('active', section.dataset.view === view);
        });

        if (view === 'dashboard') {
            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    this.renderDashboardCharts();
                    this.redimensionarDashboard();
                });
            });
        }
    }

    redimensionarDashboard() {
        Object.values(this.dashboardCharts).forEach((chart) => {
            if (chart) {
                chart.resize();
                chart.update('none');
            }
        });
    }

    getPeriodoEmDias() {
        if (this.dashboardPeriod === 'all') return null;
        const dias = Number(this.dashboardPeriod);
        return Number.isFinite(dias) ? dias : null;
    }

    parseDataProduto(produto) {
        const raw = produto.dataAtualizacao || produto.dataCriacao || produto.updatedAt || produto.createdAt;
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
                const day = Number(dayText);
                const month = Number(monthText) - 1;
                const year = Number(yearText);
                const parsed = new Date(year, month, day);
                return Number.isNaN(parsed.getTime()) ? null : parsed;
            }

            const fallback = new Date(raw);
            return Number.isNaN(fallback.getTime()) ? null : fallback;
        }

        return null;
    }

    aplicarFiltroPeriodo(produtos) {
        const dias = this.getPeriodoEmDias();
        if (!dias) return produtos;

        const limite = Date.now() - dias * 24 * 60 * 60 * 1000;

        return produtos.filter((produto) => {
            const data = this.parseDataProduto(produto);
            return data && data.getTime() >= limite;
        });
    }

    calcularDashboard() {
        const produtosFiltrados = this.aplicarFiltroPeriodo(this.produtos);
        const totalProdutos = produtosFiltrados.length;
        const totalItens = produtosFiltrados.reduce((sum, p) => sum + Number(p.quantidade), 0);
        const totalValor = produtosFiltrados.reduce((sum, p) => sum + (Number(p.quantidade) * Number(p.preco)), 0);
        const produtosBaixos = produtosFiltrados.filter(p => Number(p.quantidade) < 10).length;
        const categorias = {};

        produtosFiltrados.forEach((produto) => {
            const categoria = produto.categoria || 'Outros';
            if (!categorias[categoria]) {
                categorias[categoria] = { quantidade: 0, valor: 0, produtos: 0 };
            }

            categorias[categoria].quantidade += Number(produto.quantidade) || 0;
            categorias[categoria].valor += (Number(produto.quantidade) || 0) * (Number(produto.preco) || 0);
            categorias[categoria].produtos += 1;
        });

        return {
            totalProdutos,
            totalItens,
            totalValor,
            produtosBaixos,
            categorias
        };
    }

    atualizarDashboard() {
        const data = this.calcularDashboard();
        const categoryEntries = Object.entries(data.categorias);
        const totalCatQuantidade = categoryEntries.reduce((sum, [, info]) => sum + info.quantidade, 0) || 1;
        const totalCatValor = categoryEntries.reduce((sum, [, info]) => sum + info.valor, 0) || 1;
        const produtosSaudaveis = data.totalProdutos - data.produtosBaixos;
        const lowStockPct = data.totalProdutos ? (data.produtosBaixos / data.totalProdutos) * 100 : 0;
        const healthyPct = data.totalProdutos ? (produtosSaudaveis / data.totalProdutos) * 100 : 0;
        const topValueCategory = [...categoryEntries].sort((a, b) => b[1].valor - a[1].valor)[0];
        const topValuePct = topValueCategory ? ((topValueCategory[1].valor / totalCatValor) * 100) : 0;
        const periodoLabel = this.dashboardPeriod === 'all' ? 'todo o estoque' : `ultimos ${this.dashboardPeriod} dias`;

        document.getElementById('dashLowStockPct').textContent = `${lowStockPct.toFixed(1)}%`;
        document.getElementById('dashLowStockDetail').textContent = `${data.produtosBaixos} de ${data.totalProdutos} produtos em ${periodoLabel}`;
        document.getElementById('dashItemsPct').textContent = `${healthyPct.toFixed(1)}%`;
        document.getElementById('dashItemsDetail').textContent = `${produtosSaudaveis} de ${data.totalProdutos} produtos sem alerta em ${periodoLabel}`;
        document.getElementById('dashValuePct').textContent = topValueCategory ? `${topValuePct.toFixed(1)}%` : '0%';
        document.getElementById('dashValueDetail').textContent = topValueCategory ? `${topValueCategory[0]} lidera o valor total em ${periodoLabel}` : '0 categorias analisadas';

        const topCategory = categoryEntries.sort((a, b) => b[1].quantidade - a[1].quantidade)[0];
        if (topCategory) {
            const topCategoryPct = ((topCategory[1].quantidade / totalCatQuantidade) * 100).toFixed(1);
            document.getElementById('dashTopCategory').textContent = topCategory[0];
            document.getElementById('dashTopCategoryDetail').textContent = `${topCategoryPct}% do total de itens em ${periodoLabel}`;
        } else {
            document.getElementById('dashTopCategory').textContent = '-';
            document.getElementById('dashTopCategoryDetail').textContent = '0%';
        }

        const list = document.getElementById('categoryPercentList');
        if (list) {
            if (categoryEntries.length === 0) {
                list.innerHTML = '<p class="empty-state">Nenhuma categoria para exibir ainda.</p>';
            } else {
                list.innerHTML = categoryEntries.map(([categoria, info]) => {
                    const qtyPct = ((info.quantidade / totalCatQuantidade) * 100).toFixed(1);
                    const valueShare = ((info.valor / totalCatValor) * 100).toFixed(1);
                    return `
                        <div class="category-percent-item">
                            <header>
                                <h4>${this.escaparHTML(categoria)}</h4>
                                <span>${qtyPct}%</span>
                            </header>
                            <div class="progress-track"><div class="progress-fill" style="width:${qtyPct}%"></div></div>
                            <div class="category-meta">
                                <span>${info.quantidade} itens</span>
                                <span>${valueShare}% do valor</span>
                            </div>
                        </div>
                    `;
                }).join('');
            }
        }

        if (this.activeView === 'dashboard') {
            this.renderDashboardCharts();
        }
    }

    renderDashboardCharts() {
        if (!window.Chart) return;

        const data = this.calcularDashboard();
        const categoryEntries = Object.entries(data.categorias).sort((a, b) => b[1].quantidade - a[1].quantidade);
        const categoryLabels = categoryEntries.map(([categoria]) => categoria);
        const categoryValues = categoryEntries.map(([, info]) => info.quantidade);
        const stockLabels = ['Estoque saudável', 'Estoque baixo'];
        const stockValues = [data.totalProdutos - data.produtosBaixos, data.produtosBaixos];

        const categoryCtx = document.getElementById('categoryChart');
        const statusCtx = document.getElementById('statusChart');

        if (categoryCtx) {
            if (this.dashboardCharts.category) {
                this.dashboardCharts.category.data.labels = categoryLabels;
                this.dashboardCharts.category.data.datasets[0].data = categoryValues;
                this.dashboardCharts.category.update();
            } else {
                this.dashboardCharts.category = new Chart(categoryCtx, {
                    type: 'doughnut',
                    data: {
                        labels: categoryLabels,
                        datasets: [{
                            data: categoryValues,
                            backgroundColor: ['#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ef4444', '#14b8a6'],
                            borderWidth: 0
                        }]
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        plugins: {
                            legend: {
                                position: 'bottom'
                            },
                            tooltip: {
                                callbacks: {
                                    label: (context) => {
                                        const total = context.dataset.data.reduce((sum, value) => sum + value, 0) || 1;
                                        const value = context.raw || 0;
                                        const pct = ((value / total) * 100).toFixed(1);
                                        return ` ${context.label}: ${value} itens (${pct}%)`;
                                    }
                                }
                            }
                        }
                    }
                });
            }
        }

        if (statusCtx) {
            if (this.dashboardCharts.status) {
                this.dashboardCharts.status.data.labels = stockLabels;
                this.dashboardCharts.status.data.datasets[0].data = stockValues;
                this.dashboardCharts.status.update();
            } else {
                this.dashboardCharts.status = new Chart(statusCtx, {
                    type: 'doughnut',
                    data: {
                        labels: stockLabels,
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
                            legend: {
                                position: 'bottom'
                            },
                            tooltip: {
                                callbacks: {
                                    label: (context) => {
                                        const total = context.dataset.data.reduce((sum, value) => sum + value, 0) || 1;
                                        const value = context.raw || 0;
                                        const pct = ((value / total) * 100).toFixed(1);
                                        return ` ${context.label}: ${value} produtos (${pct}%)`;
                                    }
                                }
                            }
                        }
                    }
                });
            }
        }

        this.redimensionarDashboard();
    }

    async exportarXLSX() {
        try {
            const filename = `estoque_${new Date().toISOString().split('T')[0]}.xlsx`;
            await this.api.download('/products/export/xlsx', filename);
            this.mostrarNotificacao('Dados exportados em XLSX com sucesso!', 'success');
        } catch (error) {
            this.tratarErroApi(error, 'Erro ao exportar XLSX.');
        }
    }

    async exportarPDF() {
        try {
            const filename = `estoque_${new Date().toISOString().split('T')[0]}.pdf`;
            await this.api.download('/products/export/pdf', filename);
            this.mostrarNotificacao('Dados exportados em PDF com sucesso!', 'success');
        } catch (error) {
            this.tratarErroApi(error, 'Erro ao exportar PDF.');
        }
    }

    async importarDados(event) {
        const file = event.target.files[0];
        if (!file) return;

        try {
            const extensao = file.name.split('.').pop().toLowerCase();

            if (extensao === 'json') {
                const conteudo = await file.text();
                const dados = JSON.parse(conteudo);
                const produtos = dados.produtos || dados;
                this.validarProdutosImportados(produtos);
                await this.api.importProducts(produtos);
            } else if (extensao === 'xml') {
                const xml = await file.text();
                await this.api.importXml(xml);
            } else if (extensao === 'xlsx' || extensao === 'xls' || extensao === 'pdf') {
                await this.api.importFile(file);
            } else {
                throw new Error('Formato nao suportado. Use JSON, XML, XLSX ou PDF.');
            }

            await this.carregarProdutos();
            this.mostrarNotificacao('Dados importados com sucesso!', 'success');
        } catch (erro) {
            alert('Erro ao importar arquivo: ' + erro.message);
        }

        event.target.value = '';
    }

    validarProdutosImportados(produtos) {
        if (!Array.isArray(produtos)) {
            throw new Error('Formato de dados invalido.');
        }

        produtos.forEach(p => {
            if (!p.nome || p.quantidade === undefined || p.preco === undefined) {
                throw new Error('Produto com dados incompletos.');
            }
        });
    }

    async limparTudo() {
        try {
            await this.api.importProducts([]);
            this.produtos = [];
            this.renderizar();
            this.atualizarEstatisticas();
            this.mostrarNotificacao('Todos os dados foram limpos!', 'success');
        } catch (error) {
            this.tratarErroApi(error, 'Erro ao limpar dados.');
        }
    }

    abrirModal(modalId) {
        document.getElementById(modalId).classList.add('show');
    }

    fecharModal(modalId) {
        document.getElementById(modalId).classList.remove('show');
    }

    escaparHTML(texto) {
        const div = document.createElement('div');
        div.textContent = texto;
        return div.innerHTML;
    }

    mostrarNotificacao(mensagem, tipo = 'info') {
        const notification = document.createElement('div');
        notification.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            padding: 15px 20px;
            background: ${tipo === 'success' ? '#10b981' : '#4f46e5'};
            color: white;
            border-radius: 8px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.15);
            z-index: 2000;
            animation: slideIn 0.3s ease-out;
        `;
        notification.textContent = mensagem;
        document.body.appendChild(notification);

        setTimeout(() => {
            notification.style.animation = 'slideOut 0.3s ease-out';
            setTimeout(() => notification.remove(), 300);
        }, 3000);
    }

    tratarErroApi(error, fallbackMessage) {
        if (error?.message === 'Failed to fetch') {
            this.authManager.setApiStatus('offline', 'API offline');
        }

        if (error?.status === 401) {
            this.authManager.logout('Sessao expirada. Entre novamente.');
            return;
        }

        alert(error?.message || fallbackMessage);
    }
}

class AuthManager {
    constructor() {
        this.api = new ApiClient();
        this.sessaoKey = 'estoqueSession';
        this.estoqueManager = null;
        this.sessionChecker = null;
        this.apiStatusChecker = null;
        this.sessionMillis = 30 * 60 * 1000;
        this.extendedSessionMillis = 24 * 60 * 60 * 1000;

        this.bootstrap();
    }

    async bootstrap() {
        this.addEventListeners();
        this.bindPasswordMeters();
        await this.verificarBackend();
        this.iniciarMonitorApi();
        this.verificarSessao();
    }

    async verificarBackend(silent = false) {
        this.setApiStatus('checking', 'Verificando API...');

        try {
            await this.api.health();
            this.setApiStatus('online', 'API online');
            if (!silent) {
                this.setAuthFeedback('Backend conectado. Faca login para continuar.', 'info');
            }
            return true;
        } catch {
            this.setApiStatus('offline', 'API offline');
            if (!silent) {
                this.setAuthFeedback('Nao foi possivel conectar ao backend em http://localhost:3000.', 'error');
            }
            return false;
        }
    }

    iniciarMonitorApi() {
        if (this.apiStatusChecker) {
            clearInterval(this.apiStatusChecker);
        }

        this.apiStatusChecker = setInterval(() => {
            this.verificarBackend(true);
        }, 15000);
    }

    setApiStatus(status, text) {
        ['apiStatusAuth', 'apiStatusApp'].forEach((id) => {
            const el = document.getElementById(id);
            if (!el) return;

            el.classList.remove('online', 'offline', 'checking');
            el.classList.add(status);

            const textEl = el.querySelector('.api-status-text');
            if (textEl) {
                textEl.textContent = text;
            }
        });
    }

    addEventListeners() {
        const loginTabBtn = document.getElementById('showLoginTab');
        const registerTabBtn = document.getElementById('showRegisterTab');
        const recoveryTabBtn = document.getElementById('showRecoveryTab');
        const loginForm = document.getElementById('loginForm');
        const registerForm = document.getElementById('registerForm');
        const recoveryForm = document.getElementById('recoveryForm');
        const logoutBtn = document.getElementById('logoutBtn');
        const goRecoveryFromLogin = document.getElementById('goRecoveryFromLogin');
        const backToLoginFromRecovery = document.getElementById('backToLoginFromRecovery');
        const toggleLoginPassword = document.getElementById('toggleLoginPassword');
        const toggleRegisterPassword = document.getElementById('toggleRegisterPassword');
        const toggleRecoveryPassword = document.getElementById('toggleRecoveryPassword');

        loginTabBtn.addEventListener('click', () => this.mudarAba('login'));
        registerTabBtn.addEventListener('click', () => this.mudarAba('register'));
        recoveryTabBtn.addEventListener('click', () => this.mudarAba('recovery'));

        loginForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            await this.login();
        });

        registerForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            await this.cadastrar();
        });

        recoveryForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            await this.recuperarSenha();
        });

        goRecoveryFromLogin.addEventListener('click', () => {
            this.mudarAba('recovery');
            this.setAuthFeedback('Digite seu e-mail para redefinir a senha.', 'info');
        });

        backToLoginFromRecovery.addEventListener('click', () => {
            this.mudarAba('login');
            this.setAuthFeedback('Informe suas credenciais para entrar.', 'info');
        });

        toggleLoginPassword?.addEventListener('click', () => {
            this.togglePasswordVisibility('loginPassword', toggleLoginPassword);
        });

        toggleRegisterPassword?.addEventListener('click', () => {
            this.togglePasswordVisibility('registerPassword', toggleRegisterPassword);
        });

        toggleRecoveryPassword?.addEventListener('click', () => {
            this.togglePasswordVisibility('newRecoveryPassword', toggleRecoveryPassword);
        });

        logoutBtn.addEventListener('click', () => {
            this.logout('Sessao encerrada com sucesso.');
        });
    }

    togglePasswordVisibility(inputId, button) {
        const input = document.getElementById(inputId);
        if (!input || !button) return;

        const isPassword = input.type === 'password';
        input.type = isPassword ? 'text' : 'password';
        button.textContent = isPassword ? 'Ocultar' : 'Mostrar';
        button.setAttribute('aria-label', isPassword ? 'Ocultar senha' : 'Mostrar senha');
    }

    bindPasswordMeters() {
        const registerPassword = document.getElementById('registerPassword');
        const recoveryPassword = document.getElementById('newRecoveryPassword');

        registerPassword.addEventListener('input', () => {
            this.updateStrengthMeter('registerPassword', 'registerStrengthBar', 'registerStrengthText');
        });

        recoveryPassword.addEventListener('input', () => {
            this.updateStrengthMeter('newRecoveryPassword', 'recoveryStrengthBar', 'recoveryStrengthText');
        });
    }

    updateStrengthMeter(inputId, barId, textId) {
        const senha = document.getElementById(inputId).value;
        const barra = document.getElementById(barId);
        const texto = document.getElementById(textId);
        const forca = this.avaliarForcaSenha(senha);

        barra.style.width = `${Math.max(8, forca.pontos * 20)}%`;
        barra.style.background = forca.cor;
        texto.textContent = `Forca da senha: ${forca.rotulo}`;
    }

    avaliarForcaSenha(senha) {
        let pontos = 0;
        if (senha.length >= 8) pontos += 1;
        if (/[A-Z]/.test(senha)) pontos += 1;
        if (/[a-z]/.test(senha)) pontos += 1;
        if (/\d/.test(senha)) pontos += 1;
        if (/[^\w\s]/.test(senha)) pontos += 1;

        if (pontos <= 2) return { pontos, rotulo: 'Fraca', cor: '#ef4444' };
        if (pontos === 3) return { pontos, rotulo: 'Media', cor: '#f59e0b' };
        if (pontos === 4) return { pontos, rotulo: 'Forte', cor: '#3b82f6' };
        return { pontos, rotulo: 'Muito forte', cor: '#10b981' };
    }

    normalizeEmail(email) {
        return String(email || '').trim().toLowerCase();
    }

    emailValido(email) {
        return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    }

    validarPoliticaSenha(senha) {
        return senha.length >= 8 && /[A-Z]/.test(senha) && /[a-z]/.test(senha) && /\d/.test(senha) && /[^\w\s]/.test(senha);
    }

    mudarAba(aba) {
        const loginTabBtn = document.getElementById('showLoginTab');
        const registerTabBtn = document.getElementById('showRegisterTab');
        const recoveryTabBtn = document.getElementById('showRecoveryTab');
        const loginForm = document.getElementById('loginForm');
        const registerForm = document.getElementById('registerForm');
        const recoveryForm = document.getElementById('recoveryForm');

        const loginAtivo = aba === 'login';
        const registerAtivo = aba === 'register';
        const recoveryAtivo = aba === 'recovery';

        loginTabBtn.classList.toggle('active', loginAtivo);
        registerTabBtn.classList.toggle('active', registerAtivo);
        recoveryTabBtn.classList.toggle('active', recoveryAtivo);
        loginForm.classList.toggle('active', loginAtivo);
        registerForm.classList.toggle('active', registerAtivo);
        recoveryForm.classList.toggle('active', recoveryAtivo);
    }

    setAuthFeedback(mensagem, tipo = 'info') {
        const feedback = document.getElementById('authFeedback');
        feedback.classList.remove('info', 'success', 'error');
        feedback.classList.add(tipo);
        feedback.textContent = mensagem;
    }

    async login() {
        const email = this.normalizeEmail(document.getElementById('loginEmail').value);
        const senha = document.getElementById('loginPassword').value;
        const manterSessao = document.getElementById('rememberSession').checked;

        if (!this.emailValido(email) || !senha) {
            this.setAuthFeedback('Informe e-mail e senha validos.', 'error');
            return;
        }

        try {
            const response = await this.api.login({ email, password: senha });
            this.setApiStatus('online', 'API online');
            this.api.token = response.token;

            const agora = Date.now();
            const ttl = manterSessao ? this.extendedSessionMillis : this.sessionMillis;
            localStorage.setItem(this.sessaoKey, JSON.stringify({
                ...response.user,
                criadoEm: agora,
                expiraEm: agora + ttl
            }));

            document.getElementById('loginForm').reset();
            this.setAuthFeedback('Login realizado com sucesso.', 'success');
            this.mostrarApp();
        } catch (error) {
            if (error.message === 'Failed to fetch') {
                this.setApiStatus('offline', 'API offline');
            }
            this.setAuthFeedback(error.message || 'Falha ao autenticar.', 'error');
        }
    }

    async cadastrar() {
        const nome = document.getElementById('registerName').value.trim();
        const email = this.normalizeEmail(document.getElementById('registerEmail').value);
        const senha = document.getElementById('registerPassword').value;
        const confirmarSenha = document.getElementById('registerConfirmPassword').value;

        if (!nome || !this.emailValido(email)) {
            this.setAuthFeedback('Informe nome e e-mail validos.', 'error');
            return;
        }

        if (!this.validarPoliticaSenha(senha)) {
            this.setAuthFeedback('Senha fraca. Use 8+ caracteres com maiuscula, minuscula, numero e simbolo.', 'error');
            return;
        }

        if (senha !== confirmarSenha) {
            this.setAuthFeedback('A confirmacao da senha nao confere.', 'error');
            return;
        }

        try {
            await this.api.register({ name: nome, email, password: senha });
            this.setApiStatus('online', 'API online');
            document.getElementById('registerForm').reset();
            this.updateStrengthMeter('registerPassword', 'registerStrengthBar', 'registerStrengthText');
            this.mudarAba('login');
            document.getElementById('loginEmail').value = email;
            this.setAuthFeedback('Conta criada com sucesso. Agora faca login.', 'success');
        } catch (error) {
            if (error.message === 'Failed to fetch') {
                this.setApiStatus('offline', 'API offline');
            }
            this.setAuthFeedback(error.message || 'Falha ao criar conta.', 'error');
        }
    }

    async recuperarSenha() {
        const email = this.normalizeEmail(document.getElementById('recoveryEmail').value);
        const novaSenha = document.getElementById('newRecoveryPassword').value;
        const confirmaSenha = document.getElementById('confirmRecoveryPassword').value;

        if (!this.emailValido(email)) {
            this.setAuthFeedback('Informe um e-mail valido.', 'error');
            return;
        }

        if (!this.validarPoliticaSenha(novaSenha)) {
            this.setAuthFeedback('Senha fraca. Use 8+ caracteres com maiuscula, minuscula, numero e simbolo.', 'error');
            return;
        }

        if (novaSenha !== confirmaSenha) {
            this.setAuthFeedback('A confirmacao da senha nao confere.', 'error');
            return;
        }

        try {
            await this.api.recover({ email, newPassword: novaSenha });
            this.setApiStatus('online', 'API online');
            document.getElementById('recoveryForm').reset();
            this.updateStrengthMeter('newRecoveryPassword', 'recoveryStrengthBar', 'recoveryStrengthText');
            this.mudarAba('login');
            document.getElementById('loginEmail').value = email;
            this.setAuthFeedback('Senha redefinida com sucesso. Faca login.', 'success');
        } catch (error) {
            if (error.message === 'Failed to fetch') {
                this.setApiStatus('offline', 'API offline');
            }
            this.setAuthFeedback(error.message || 'Falha ao recuperar senha.', 'error');
        }
    }

    logout(mensagem = 'Sessao encerrada.') {
        this.api.token = null;
        localStorage.removeItem(this.sessaoKey);

        if (this.sessionChecker) {
            clearInterval(this.sessionChecker);
            this.sessionChecker = null;
        }

        if (this.apiStatusChecker) {
            clearInterval(this.apiStatusChecker);
            this.apiStatusChecker = null;
        }

        document.getElementById('appContainer').classList.add('app-hidden');
        document.getElementById('appContainer').setAttribute('aria-hidden', 'true');
        document.getElementById('authContainer').style.display = 'flex';
        this.mudarAba('login');
        this.setAuthFeedback(mensagem, 'info');
        this.iniciarMonitorApi();
    }

    verificarSessao() {
        const sessaoRaw = localStorage.getItem(this.sessaoKey);
        if (!sessaoRaw || !this.api.token) {
            this.mudarAba('login');
            this.setAuthFeedback('Informe suas credenciais para continuar.', 'info');
            return;
        }

        try {
            const sessao = JSON.parse(sessaoRaw);
            if (!sessao.email || !sessao.expiraEm || Date.now() > sessao.expiraEm) {
                this.logout('Sessao expirada. Entre novamente.');
                return;
            }

            this.mostrarApp();
        } catch {
            this.logout('Sessao invalida. Entre novamente.');
        }
    }

    iniciarMonitorSessao() {
        if (this.sessionChecker) clearInterval(this.sessionChecker);

        this.sessionChecker = setInterval(() => {
            const sessaoRaw = localStorage.getItem(this.sessaoKey);
            if (!sessaoRaw) return;

            const sessao = JSON.parse(sessaoRaw);
            if (!sessao.expiraEm || Date.now() > sessao.expiraEm) {
                this.logout('Sessao expirada por seguranca.');
            }
        }, 30000);
    }

    mostrarApp() {
        const sessao = JSON.parse(localStorage.getItem(this.sessaoKey) || '{}');
        document.getElementById('loggedUserText').textContent = `Conectado como ${sessao.name || sessao.email || 'Usuario'}`;

        document.getElementById('authContainer').style.display = 'none';
        const appContainer = document.getElementById('appContainer');
        appContainer.classList.remove('app-hidden');
        appContainer.setAttribute('aria-hidden', 'false');

        if (!this.estoqueManager) {
            this.estoqueManager = new EstoqueManager(this.api, this);
        } else {
            this.estoqueManager.carregarProdutos();
        }

        this.iniciarMonitorSessao();
    }
}

document.addEventListener('DOMContentLoaded', () => {
    new AuthManager();
});

const style = document.createElement('style');
style.textContent = `
    @keyframes slideOut {
        to {
            opacity: 0;
            transform: translateX(100%);
        }
    }
`;
document.head.appendChild(style);
