# Seu Alves · Sistema de Gestão de Delivery

Sistema próprio do Seu Alves Lanches para unir atendimento, pedidos de todos os canais (iFood, cardápio próprio, WhatsApp e balcão), cozinha, estoque e financeiro.

- **Plano de arquitetura:** [`docs/arquitetura.md`](docs/arquitetura.md)
- **Cardápio digital atual (estático):** [`index.html`](index.html), publicado pelo GitHub Pages. Continua funcionando enquanto o sistema novo é construído.

## Estrutura

```
apps/
  api/        API do núcleo (NestJS): login, cardápio, pedidos, tempos por etapa
  worker/     Filas e tarefas agendadas (BullMQ): polling do iFood a cada 30 s, outbox
  web/        Telas internas (React + Vite + Tailwind, na identidade da marca): login e KDS
packages/
  shared/     Regras compartilhadas: máquina de estados do pedido, tempos/SLA, dinheiro em centavos, validações
  db/         Esquema do banco (Prisma + PostgreSQL), migrations e seed
infra/
  docker-compose.yml   PostgreSQL e Redis para rodar localmente
```

## Rodando localmente

Pré-requisitos: Node.js 22, pnpm 10 e Docker (ou PostgreSQL 16 e Redis 7 instalados).

```bash
cp .env.example .env                       # preencha OWNER_EMAIL, OWNER_PASSWORD e JWT_SECRET
cp apps/web/.env.example apps/web/.env
docker compose -f infra/docker-compose.yml up -d
pnpm install
pnpm --filter @seu-alves/shared --filter @seu-alves/db run build
pnpm --filter @seu-alves/db exec prisma migrate deploy
pnpm db:seed                               # cria a loja, a conta do dono e importa o cardápio do index.html
```

O seed mostra o id da loja; coloque-o em `VITE_STORE_ID` no `apps/web/.env`. Depois, em terminais separados:

```bash
pnpm --filter @seu-alves/api dev           # http://localhost:3000/health
pnpm --filter @seu-alves/worker dev
pnpm --filter @seu-alves/web dev           # http://localhost:5173
```

## Testes

```bash
pnpm -r run typecheck
pnpm -r run test                           # os testes de integração dos pedidos rodam quando DATABASE_URL está definido
```

## O que já existe (Fase 0)

- Esquema do banco multi-loja: organização, lojas, usuários e papéis, aparelhos, catálogo com adicionais e preço por canal, bairros, clientes unificados, pedidos com horário de cada etapa, histórico de status, metas de tempo, eventos de entrada (idempotência), outbox e auditoria.
- Seed que importa o cardápio e as taxas por bairro direto do `index.html`.
- API com login do dono (e-mail e senha) e da equipe (PIN), permissões por papel, cardápio público, botão de esgotar produto, criação de pedido idempotente com preços recalculados pelo cadastro e senha do dia sequencial, mudança de status pela máquina de estados e métricas de tempo por etapa.
- Worker com polling do iFood a cada 30 s (liga sozinho quando as credenciais existirem), confirmação de eventos e publicação do outbox na fila.
- Tela de login e KDS (aceitar e marcar pronto) na identidade da marca.

## Próximos passos (Fase 1)

Tela de equipe (convites e PIN), PDV de balcão, impressão térmica pelo Hub da Loja, WebSocket para o KDS em tempo real, fechamento de caixa e deploy na VPS com Coolify.
