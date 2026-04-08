# Sistema Web de Controle de Estoque

Aplicacao web de controle de estoque com autenticacao, CRUD de produtos e importacao/exportacao de dados, agora operando em modo API-first.

## Arquitetura

- Front-end: HTML, CSS e JavaScript em [index.html](index.html), [style.css](style.css), [script.js](script.js)
- Back-end: Node.js + Express em [backend/src/server.js](backend/src/server.js)
- Persistencia: arquivo JSON local em [backend/data/db.json](backend/data/db.json)

## Funcionalidades

- Login, cadastro e recuperacao de senha
- CRUD completo de produtos
- Busca, filtro e ordenacao
- Estatisticas em tempo real
- Importacao de dados: JSON, XML, PDF (PDF com payload exportado pelo sistema)
- Exportacao de dados: XLSX, PDF

## Requisitos

- Node.js 18+
- npm
- Navegador moderno

## Como executar (padrao)

1. Instale dependencias do backend:

```bash
cd backend
npm install
```

2. Crie o arquivo `.env` na pasta `backend` com base no `.env.example`.

3. Inicie a API:

```bash
npm run dev
```

4. Abra o front-end no navegador:
- Opcao simples: abra [index.html](index.html)
- Opcao recomendada: use Live Server

5. Acesse com o usuario padrao:
- Email: `admin@estoque.com`
- Senha: `admin123`

## API principal

Base URL: `http://localhost:3000/api`

Autenticacao:
- `POST /auth/register`
- `POST /auth/login`
- `POST /auth/recover`

Produtos (Bearer token):
- `GET /products`
- `POST /products`
- `PUT /products/:id`
- `DELETE /products/:id`

Importacao/exportacao:
- `POST /products/import`
- `POST /products/import/xml`
- `GET /products/export/xlsx`
- `GET /products/export/pdf`

## Observacoes importantes

- O front-end depende do backend ativo em `http://localhost:3000`.
- O token JWT e metadados de sessao ficam no navegador para controle de acesso do front-end.
- O backend isola os produtos por usuario autenticado.
- O arquivo [backend/data/db.json](backend/data/db.json) e o banco local de desenvolvimento.

## Estrutura

```text
Projeto Controle de Estoque/
|-- index.html
|-- style.css
|-- script.js
|-- README.md
`-- backend/
    |-- .env.example
    |-- package.json
    |-- data/
    |   `-- db.json
    `-- src/
        |-- auth.js
        |-- db.js
        `-- server.js
```
