import type { PrismaClient } from '@seu-alves/db';
import { ifoodEventToUpdate } from './ifood-shipping';
import { n99PayloadToUpdate } from './n99-entrega';
import { applyDeliveryUpdate } from './sync';
import type { DeliveryUpdate } from './types';

/** Converte o corpo de um aviso automático para atualizações de entrega. */
export function webhookToUpdates(provider: string, body: unknown): DeliveryUpdate[] {
  const list = Array.isArray(body) ? body : [body];
  const out: DeliveryUpdate[] = [];
  for (const item of list) {
    const u =
      provider === 'ifood'
        ? ifoodEventToUpdate(item as Parameters<typeof ifoodEventToUpdate>[0])
        : provider === 'n99'
          ? n99PayloadToUpdate(item)
          : null;
    if (u) out.push(u);
  }
  return out;
}

/**
 * Processa os avisos que a API gravou em inbound_events (provider 'webhook:ifood' ou 'webhook:n99').
 * Erro em um aviso não trava os outros: fica registrado com o número de tentativas (desiste após 5).
 */
export async function processDeliveryWebhooks(prisma: PrismaClient, batch = 50) {
  const pending = await prisma.inboundEvent.findMany({
    where: { provider: { startsWith: 'webhook:' }, processedAt: null, attempts: { lt: 5 } },
    orderBy: { receivedAt: 'asc' },
    take: batch,
  });
  for (const ev of pending) {
    try {
      for (const u of webhookToUpdates(ev.provider.slice('webhook:'.length), ev.payload)) await applyDeliveryUpdate(prisma, u);
      await prisma.inboundEvent.update({ where: { id: ev.id }, data: { processedAt: new Date(), error: null } });
    } catch (e) {
      await prisma.inboundEvent.update({ where: { id: ev.id }, data: { attempts: { increment: 1 }, error: String(e).slice(0, 500) } });
    }
  }
  return pending.length;
}
