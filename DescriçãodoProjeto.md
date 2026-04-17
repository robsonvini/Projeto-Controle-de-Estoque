# Instruções Customizadas - Sistema de Controle de Estoque

## Descrição do Projeto

Sistema web de controle de estoque com front-end em React carregado no navegador e backend em Node.js + Express.

## Tecnologias Utilizadas

- **HTML5**: Estrutura da página
- **CSS3**: Interface responsiva e visual moderno
- **React**: Renderização do front-end
- **Node.js + Express**: API, autenticação e persistência local
- **JSON local**: Armazenamento em [backend/data/db.json](backend/data/db.json)

## Arquivos Principais

- [index.html](index.html) - Página base que carrega as bibliotecas e o app
- [bootstrap.js](bootstrap.js) - Loader do [app.jsx](app.jsx)
- [app.jsx](app.jsx) - Interface e lógica do front-end
- [style.css](style.css) - Estilos da aplicação
- [backend/src/server.js](backend/src/server.js) - API principal
- [backend/src/auth.js](backend/src/auth.js) - Autenticação JWT e senha
- [backend/src/db.js](backend/src/db.js) - Leitura e escrita do banco local

## Funcionalidades Principais

### 1. Autenticação
- Cadastro, login e recuperação de senha
- Sessão com token JWT

### 2. Produtos
- Criar, listar, editar e remover produtos
- Filtros, busca, ordenação e alerta de estoque baixo

### 3. Movimentações
- Registro de entradas e saídas por produto
- Histórico com filtros por período, tipo e produto

### 4. Importação e Exportação
- Importação de JSON, XML, XLSX, XLS e PDF
- Exportação de XLSX e PDF

### 5. Dashboard
- Indicadores de saúde do estoque
- Gráficos e relatórios em tempo real

## Como Abrir o Projeto

1. Inicie o backend em [backend](backend) com `npm run dev`.
2. Abra [http://localhost:3000](http://localhost:3000) no navegador.

No Windows, o atalho [iniciar-localhost.bat](iniciar-localhost.bat) faz esse fluxo automaticamente.

## Estrutura de Dados (Produto)

```javascript
{
  id: 1234567890,
  userId: 987654321,
  nome: "Produto",
  categoria: "Eletrônicos",
  quantidade: 10,
  preco: 99.9,
  descricao: "...",
  dataCriacao: "06/04/2026",
  dataAtualizacao: "06/04/2026",
  createdAt: "2026-04-06T12:00:00.000Z",
  updatedAt: "2026-04-06T12:00:00.000Z"
}
```

## Observações

- O front depende do backend ativo em `http://localhost:3000`.
- O arquivo [backend/data/db.json](backend/data/db.json) é o banco local de desenvolvimento.
- As bibliotecas externas do front são carregadas via CDN.

**Versão**: 2.0.0
**Última Atualização**: 17/04/2026
