# Instruções Customizadas - Sistema de Controle de Estoque

## Descrição do Projeto

Sistema web completo de controle de estoque desenvolvido em JavaScript puro com:
- Interface responsiva e moderna
- CRUD completo (Criar, Ler, Atualizar, Deletar)
- Persistência de dados com localStorage
- Filtros, busca e ordenação
- Exportação/Importação de dados em JSON
- Dashboard com estatísticas
- Alerta de estoque baixo

## Tecnologias Utilizadas

- **HTML5**: Estrutura semântica
- **CSS3**: Design responsivo com Grid e Flexbox
- **JavaScript ES6+**: Lógica do sistema com POO (Programação Orientada a Objetos)
- **localStorage API**: Armazenamento de dados

## Arquivos Principais

- `index.html` - Página principal com formulários e containers
- `style.css` - Estilos responsivos e design moderno (600+ linhas)
- `script.js` - Lógica do sistema com classe EstoqueManager (500+ linhas)
- `README.md` - Documentação completa do projeto

## Funcionalidades Principais

### 1. Gerenciamento de Produtos
- Adicionar produtos com os campos: nome, categoria, quantidade, preço, descrição
- Editar produtos em modal integrado
- Deletar produtos com confirmação
- Visualizar detalhes completos em modal

### 2. Filtros e Busca
- Busca em tempo real por nome, categoria ou descrição
- Filtro por categoria específica
- Ordenação por: nome, quantidade, preço ou categoria

### 3. Dashboard
- Total de produtos diferentes
- Valor total em estoque
- Total de itens
- Contador de produtos com estoque baixo (< 10 unidades)

### 4. Dados
- Persistência automática via localStorage
- Exportação em JSON
- Importação de backup em JSON
- Limpeza total com confirmação

### 5. Interface
- Responsiva (desktop, tablet, mobile)
- Animações suaves
- Notificações de ação
- Categorias com cores diferentes
- Cards com hover effects

## Como Abrir o Projeto

Simplesmente abra o arquivo `index.html` em um navegador web.

**Nenhuma instalação, servidor ou dependência necessária.**

## Estrutura de Dados (Produto)

```javascript
{
  id: 1234567890,                    // Timestamp único
  nome: "Produto",                   // Texto
  categoria: "Eletrônicos",          // Seleção
  quantidade: 10,                    // Número inteiro
  preco: 99.90,                      // Número decimal
  descricao: "...",                  // Texto opcional
  dataCriacao: "06/04/2026",        // Data de criação
  dataAtualizacao: "06/04/2026"     // Data de última atualização
}
```

## Categorias Suportadas

- Eletrônicos (azul)
- Alimentos (verde)
- Roupas (amarelo)
- Higiene (roxo)
- Outros (cinza)

## Limites e Considerações

- **localStorage**: ~5-10MB por domínio
- **Performance**: Máximo recomendado de ~5000 produtos
- **Compatibilidade**: Navegadores modernos (Chrome, Firefox, Safari, Edge)

## Próximos Passos Recomendados

1. Testar a adição de produtos
2. Experimentar filtros e busca
3. Testar exportação/importação
4. Adicionar mais categorias conforme necessário

## Dicas de Customização

Para adicionar uma nova categoria:
1. Abra `index.html`
2. Encontre os `<option value="NovaCategoria">` e adicione a categoria
3. Abra `style.css`
4. Procure por `.product-category.Eletrônicos` e adicione um novo estilo com a cor desejada

## Troubleshooting

**Dados não aparecem após recarregar:**
- Verifique se o localStorage está habilitado
- Abra DevTools (F12) > Application > Storage > Local Storage

**Importação não funciona:**
- Verifique se o arquivo JSON está no formato correto
- O arquivo deve conter uma array "produtos" ou ser direto a array

**Estilo não aparece correto em mobile:**
- Recarregue a página (Ctrl+Shift+R ou Cmd+Shift+R)
- Limpe o cache do navegador

---

**Versão**: 1.0.0
**Última Atualização**: 06/04/2026
