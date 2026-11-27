import { Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';
import { PrismaClient } from '@seu-alves/db';
import { IfoodClient } from './ifood-client';
import { pollOnce } from './ifood-poller';
import { dispatchOutbox } from './outbox';
import { N99EntregaAdapter } from './delivery/n99-entrega';
import { processDeliveryWebhooks } from './delivery/webhooks';

const connection = new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6379', { maxRetriesPerRequest: null });
const prisma = new PrismaClient();

const schedules = new Queue('schedules', { connection });
const events = new Queue('events', { connection });

const ifoodConfigured = Boolean(process.env.IFOOD_CLIENT_ID && process.env.IFOOD_CLIENT_SECRET && process.env.IFOOD_MERCHANT_ID);
const ifood = ifoodConfigured
  ? new IfoodClient({
      baseUrl: process.env.IFOOD_API_BASE ?? 'https://merchant-api.ifood.com.br',
      clientId: process.env.IFOOD_CLIENT_ID!,
      clientSecret: process.env.IFOOD_CLIENT_SECRET!,
      merchantId: process.env.IFOOD_MERCHANT_ID!,
    })
  : null;

// 99 Entrega: liga sozinho quando as chaves estiverem no .env (ou na tela de integrações, numa próxima fase).
const n99 =
  process.env.N99_CLIENT_ID && process.env.N99_CLIENT_SECRET && process.env.N99_API_BASE
    ? new N99EntregaAdapter({
        baseUrl: process.env.N99_API_BASE,
        clientId: process.env.N99_CLIENT_ID,
        clientSecret: process.env.N99_CLIENT_SECRET,
        paths: {
          ...(process.env.N99_PATH_TOKEN ? { token: process.env.N99_PATH_TOKEN } : {}),
          ...(process.env.N99_PATH_QUOTE ? { quote: process.env.N99_PATH_QUOTE } : {}),
          ...(process.env.N99_PATH_CREATE ? { create: process.env.N99_PATH_CREATE } : {}),
          ...(process.env.N99_PATH_GET ? { get: process.env.N99_PATH_GET } : {}),
          ...(process.env.N99_PATH_CANCEL ? { cancel: process.env.N99_PATH_CANCEL } : {}),
        },
      })
    : null;
export const deliveryAdapters = { n99 };

async function main() {
  // Jobs repetitivos. O BullMQ garante uma execução por intervalo, mesmo com vários workers.
  await schedules.upsertJobScheduler('outbox', { every: 2_000 }, { name: 'outbox' });
  // Avisos automáticos dos provedores de entrega (gravados pela API em inbound_events).
  await schedules.upsertJobScheduler('delivery-webhooks', { every: 3_000 }, { name: 'delivery-webhooks' });
  console.log(n99 ? '99 Entrega: ligada' : '99 Entrega: credenciais ausentes (preencha N99_* no .env)');
  if (ifood) {
    await schedules.upsertJobScheduler('ifood-polling', { every: 30_000 }, { name: 'ifood-polling' });
    console.log('iFood: polling a cada 30 s ativado');
  } else {
    await schedules.removeJobScheduler('ifood-polling');
    console.log('iFood: credenciais ausentes, polling desligado (preencha IFOOD_* no .env)');
  }

  new Worker(
    'schedules',
    async (job) => {
      if (job.name === 'outbox') return dispatchOutbox(prisma, events);
      if (job.name === 'delivery-webhooks') return processDeliveryWebhooks(prisma);
      if (job.name === 'ifood-polling' && ifood) {
        const r = await pollOnce(ifood, prisma);
        await connection.set('health:ifood-polling', new Date().toISOString());
        return r;
      }
    },
    { connection, concurrency: 1 },
  );

  // Consumidores dos eventos do núcleo (KDS, impressão, financeiro...) entram aqui nas próximas fases.
  new Worker(
    'events',
    async (job) => {
      console.log(`[evento] ${job.name}`, JSON.stringify(job.data));
    },
    { connection, concurrency: 5 },
  );

  console.log('Worker do Seu Alves rodando');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
