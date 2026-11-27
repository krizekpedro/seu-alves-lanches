# Dados trazidos da OlaClick

Lidos do painel da OlaClick em 27/11/2026, sem alterar nada lá.

- `cardapio.json`: categorias, produtos (inclusive os escondidos), tamanhos, preços e os grupos de adicionais e complementos. O `foto` de cada produto aponta para `assets/img/produtos/<foto>.webp`.
- `loja.json`: horários, bairros e taxas, canais, formas de pagamento, cupom e programa de fidelidade.

O seed do banco (`pnpm db:seed`) importa o `cardapio.json` automaticamente. A conversão fica em `packages/shared/src/olaclick.ts`.

Relatórios de vendas e dados de clientes não ficam neste repositório, porque ele é público.
