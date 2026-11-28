import { nextDeliveryStatus, shouldNotifyArriving, type DeliveryStatus } from '@seu-alves/shared';
import type { PrismaClient } from '@seu-alves/db';
import type { DeliveryUpdate } from './types';

const STAMP: Partial<Record<DeliveryStatus, 'assignedAt' | 'arrivedStoreAt' | 'pickedUpAt' | 'deliveredAt' | 'cancelledAt'>> = {
  ENTREGADOR_ATRIBUIDO: 'assignedAt',
  NA_LOJA: 'arrivedStoreAt',
  COLETADA: 'pickedUpAt',
  ENTREGUE: 'deliveredAt',
  CANCELADA: 'cancelledAt',
  FALHOU: 'cancelledAt',
};

type Db = Pick<PrismaClient, 'delivery' | 'outboxEvent' | '$transaction'>;

/**
 * Aplica uma atualização de qualquer provedor na entrega e gera os eventos internos:
 * - delivery.status_changed: painel, KDS e app do dono (inclui "motoboy chegou na loja" e "saiu", que são internos);
 * - customer.notify_arriving: único aviso de entrega ao cliente, quando entra no raio (regra do Krizek);
 * - delivery.failed: alerta para a loja escolher outro entregador.
 */
export async function applyDeliveryUpdate(db: Db, u: DeliveryUpdate, now = new Date()) {
  const d = await db.delivery.findUnique({
    where: { provider_externalId: { provider: u.provider, externalId: u.externalId } },
    include: { order: { include: { store: true } } },
  });
  if (!d) return { applied: false as const, reason: 'entrega desconhecida' };

  const status = nextDeliveryStatus(d.status as DeliveryStatus, u.status);
  const loc = u.courier?.location;
  const changed = status !== d.status;
  const stamp = changed ? STAMP[status] : undefined;
  const at = Number.isNaN(Date.parse(u.at)) ? now : new Date(u.at);

  const notify = shouldNotifyArriving({
    status,
    courier: loc ?? (d.courierLat != null && d.courierLng != null ? { lat: d.courierLat, lng: d.courierLng } : null),
    destination: d.destLat != null && d.destLng != null ? { lat: d.destLat, lng: d.destLng } : null,
    radiusM: d.order.store.notifyRadiusM,
    alreadyNotified: d.customerNotifiedAt != null,
  });

  const events: { type: string; payload: object }[] = [];
  if (changed) {
    events.push({
      type: 'delivery.status_changed',
      payload: { deliveryId: d.id, orderId: d.orderId, provider: d.provider, from: d.status, to: status, at: at.toISOString() },
    });
    if (status === 'FALHOU') events.push({ type: 'delivery.failed', payload: { deliveryId: d.id, orderId: d.orderId, provider: d.provider } });
  }
  if (notify) {
    events.push({
      type: 'customer.notify_arriving',
      payload: { orderId: d.orderId, deliveryId: d.id, courierName: u.courier?.name ?? d.courierName, trackingUrl: u.trackingUrl ?? d.trackingUrl },
    });
  }

  await db.$transaction([
    db.delivery.update({
      where: { id: d.id },
      data: {
        status,
        ...(stamp ? { [stamp]: at } : {}),
        ...(u.courier?.name ? { courierName: u.courier.name } : {}),
        ...(u.courier?.phone ? { courierPhone: u.courier.phone } : {}),
        ...(loc ? { courierLat: loc.lat, courierLng: loc.lng } : {}),
        ...(u.trackingUrl ? { trackingUrl: u.trackingUrl } : {}),
        ...(notify ? { customerNotifiedAt: now } : {}),
        lastPayload: u.raw as object,
      },
    }),
    ...events.map((e) => db.outboxEvent.create({ data: { type: e.type, aggregateId: d.orderId, payload: e.payload } })),
  ]);
  return { applied: true as const, status, events: events.map((e) => e.type) };
}
