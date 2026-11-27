import { Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';
import { PrismaClient } from '@seu-alves/db';
import { IfoodClient } from './ifood-client';
import { pollOnce } from './ifood-poller';
import { dispatchOutbox } from './outbox';

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

async function main() {
  // Jobs repetitivos. O BullMQ garante uma execução por intervalo, mesmo com vários workers.
  await schedules.upsertJobScheduler('outbox', { every: 2_000 }, { name: 'outbox' });
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
