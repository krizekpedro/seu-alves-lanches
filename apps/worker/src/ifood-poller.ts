import type { PrismaClient } from '@seu-alves/db';
import type { IfoodClient } from './ifood-client';
import { ifoodEventToUpdate } from './delivery/ifood-shipping';
import { applyDeliveryUpdate } from './delivery/sync';

/**
 * Um ciclo de polling: busca eventos, grava cada um em inbound_events (ignorando repetidos),
 * confirma o recebimento ao iFood, baixa os detalhes dos pedidos novos (PLC) e atualiza as entregas do iFood Entrega.
 * A tradução do pedido do iFood para o pedido interno entra na Fase 3, com o
 * mapeamento de itens do catálogo (external_catalog_links).
 */
export async function pollOnce(client: IfoodClient, prisma: PrismaClient) {
  const events = await client.poll();
  let fresh = 0;
  for (const ev of events) {
    const key = `ifood:${ev.id}`;
    const known = await prisma.inboundEvent.findUnique({ where: { idempotencyKey: key } });
    if (known) continue; // evento repetido: o iFood reenvia até receber o ack
    let payload: object = { event: ev };
    if (ev.code === 'PLC') payload = { event: ev, order: await client.orderDetails(ev.orderId) };
    await prisma.inboundEvent.create({ data: { provider: 'ifood', idempotencyKey: key, payload } });
    // Eventos de logística (entregador atribuído, chegou na loja, coletou...) atualizam a entrega na hora.
    const delivery = ifoodEventToUpdate(ev);
    if (delivery) await applyDeliveryUpdate(prisma, delivery);
    fresh++;
  }
  // Ack só depois de gravar: se o processo cair antes, o iFood reenvia e a checagem por idempotency_key evita duplicar.
  await client.acknowledge(events.map((e) => e.id));
  return { received: events.length, fresh };
}
