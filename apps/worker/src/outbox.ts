import type { PrismaClient } from '@seu-alves/db';
import type { Queue } from 'bullmq';

/** Publica na fila os eventos gravados pelo núcleo (padrão Transactional Outbox). */
export async function dispatchOutbox(prisma: PrismaClient, queue: Queue, batch = 100) {
  const pending = await prisma.outboxEvent.findMany({ where: { publishedAt: null }, orderBy: { createdAt: 'asc' }, take: batch });
  for (const ev of pending) {
    await queue.add(ev.type, ev.payload, { jobId: ev.id, removeOnComplete: 1000, removeOnFail: 5000 });
    await prisma.outboxEvent.update({ where: { id: ev.id }, data: { publishedAt: new Date() } });
  }
  return pending.length;
}
