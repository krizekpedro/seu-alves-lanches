import type { DeliveryQuote } from '@seu-alves/shared';
import type { IfoodClient } from '../ifood-client';
import { IFOOD_DELIVERY_CODES } from './status-map';
import type { DeliveryAdapter, DeliveryRequest, DeliveryUpdate } from './types';

/**
 * iFood Entrega para pedidos que NÃO vieram do iFood (cardápio próprio, WhatsApp, balcão):
 * módulo Shipping, "entrega sob demanda". Usa as mesmas credenciais da Merchant API.
 * Pedidos que vieram do iFood já são entregues pelo iFood quando a loja usa a logística dele;
 * para esses, `requestDriverForIfoodOrder` chama o entregador manualmente.
 *
 * Caminhos conforme a documentação do iFood Developer (módulo Shipping); conferir na homologação.
 */
export const IFOOD_SHIPPING_PATHS = {
  availability: (merchantId: string) => `/shipping/v1.0/merchants/${merchantId}/deliveryAvailabilities`,
  createOrder: (merchantId: string) => `/shipping/v1.0/merchants/${merchantId}/orders`,
  requestDriver: (orderId: string) => `/shipping/v1.0/orders/${orderId}/requestDriver`,
  cancel: (orderId: string) => `/shipping/v1.0/orders/${orderId}/cancel`,
  tracking: (orderId: string) => `/shipping/v1.0/orders/${orderId}/tracking`,
};

const cents = (reais: number | undefined) => Math.round((reais ?? 0) * 100);
const reais = (c: number) => Math.round(c) / 100;

export class IfoodShippingAdapter implements DeliveryAdapter {
  readonly provider = 'IFOOD' as const;

  constructor(private readonly client: IfoodClient) {}

  private get merchantId() {
    return this.client.cfg.merchantId;
  }

  private async json<T>(res: Response, what: string): Promise<T> {
    if (!res.ok) throw new Error(`iFood Entrega (${what}): HTTP ${res.status} ${await res.text().catch(() => '')}`.trim());
    return (await res.json()) as T;
  }

  async quote(req: DeliveryRequest): Promise<DeliveryQuote> {
    const q = new URLSearchParams({ latitude: String(req.dropoff.location.lat), longitude: String(req.dropoff.location.lng) });
    const res = await this.client.call(`${IFOOD_SHIPPING_PATHS.availability(this.merchantId)}?${q}`);
    const body = await this.json<{
      id: string;
      expirationAt?: string;
      quote?: { grossValue?: number; netValue?: number };
      deliveryTime?: { min?: number; max?: number };
      pickupTime?: { min?: number; max?: number };
    }>(res, 'cotação');
    return {
      provider: 'IFOOD',
      externalQuoteId: body.id,
      feeCents: cents(body.quote?.netValue ?? body.quote?.grossValue),
      // tempos do iFood vêm em segundos
      pickupEtaMin: Math.ceil((body.pickupTime?.max ?? body.pickupTime?.min ?? 600) / 60),
      dropoffEtaMin: Math.ceil((body.deliveryTime?.max ?? body.deliveryTime?.min ?? 900) / 60),
      expiresAt: body.expirationAt,
    };
  }

  async request(req: DeliveryRequest) {
    const d = req.dropoff;
    const res = await this.client.call(IFOOD_SHIPPING_PATHS.createOrder(this.merchantId), {
      method: 'POST',
      headers: { 'Idempotency-Key': `entrega-${req.orderId}` },
      body: JSON.stringify({
        customer: { name: d.customerName, phone: { countryCode: '55', areaCode: d.customerPhone.slice(0, 2), number: d.customerPhone.slice(2) } },
        delivery: {
          merchantFee: 0,
          quoteId: req.quoteId,
          deliveryAddress: {
            postalCode: d.postalCode,
            streetName: d.street,
            streetNumber: d.number,
            neighborhood: d.neighborhood,
            complement: d.complement,
            reference: d.reference,
            city: d.city,
            state: d.state,
            country: 'BR',
            coordinates: { latitude: d.location.lat, longitude: d.location.lng },
          },
        },
        items: req.items.map((i, idx) => ({
          id: `${req.orderId}-${idx}`,
          name: i.name,
          quantity: i.quantity,
          unitPrice: reais(i.unitPriceCents),
          price: reais(i.unitPriceCents * i.quantity),
          totalPrice: reais(i.unitPriceCents * i.quantity),
        })),
        payments: {
          methods: [{ method: req.prepaid ? 'CREDIT' : 'CASH', type: req.prepaid ? 'ONLINE' : 'OFFLINE', value: reais(req.orderTotalCents) }],
        },
        displayId: String(req.shortNumber),
        metadata: { origem: 'seu-alves', pedido: req.orderId },
      }),
    });
    const body = await this.json<{ id: string; trackingUrl?: string }>(res, 'solicitar entregador');
    return { externalId: body.id, status: 'SOLICITADA' as const, trackingUrl: body.trackingUrl };
  }

  /** Pedido que veio do iFood e a loja quer o entregador do iFood. */
  async requestDriverForIfoodOrder(ifoodOrderId: string) {
    const res = await this.client.call(IFOOD_SHIPPING_PATHS.requestDriver(ifoodOrderId), { method: 'POST' });
    if (!res.ok && res.status !== 202) throw new Error(`iFood Entrega (chamar entregador): HTTP ${res.status}`);
  }

  async cancel(externalId: string, reason: string) {
    const res = await this.client.call(IFOOD_SHIPPING_PATHS.cancel(externalId), {
      method: 'POST',
      body: JSON.stringify({ reason, cancellationCode: '817' }),
    });
    // 202 = pedido aceito, a confirmação chega por evento (CAN ou recusa)
    if (!res.ok && res.status !== 202) throw new Error(`iFood Entrega (cancelar): HTTP ${res.status}`);
  }

  async status(externalId: string): Promise<DeliveryUpdate> {
    const res = await this.client.call(IFOOD_SHIPPING_PATHS.tracking(externalId));
    const body = await this.json<{
      latitude?: number;
      longitude?: number;
      expectedDelivery?: string;
      trackDate?: string;
      deliveryStatus?: string;
      driverName?: string;
      driverPhone?: string;
    }>(res, 'acompanhar');
    return {
      provider: 'IFOOD',
      externalId,
      status: IFOOD_DELIVERY_CODES[body.deliveryStatus ?? ''] ?? 'COLETADA',
      at: body.trackDate ?? new Date().toISOString(),
      courier: {
        name: body.driverName,
        phone: body.driverPhone,
        location: body.latitude != null && body.longitude != null ? { lat: body.latitude, lng: body.longitude } : undefined,
      },
      raw: body,
    };
  }
}

/** Evento de logística vindo do polling/webhook do iFood → atualização normalizada (ou null se não for de entrega). */
export function ifoodEventToUpdate(ev: {
  code: string;
  fullCode?: string;
  orderId: string;
  createdAt: string;
  metadata?: Record<string, unknown>;
}): DeliveryUpdate | null {
  const status = IFOOD_DELIVERY_CODES[ev.fullCode ?? ''] ?? IFOOD_DELIVERY_CODES[ev.code];
  if (!status) return null;
  const m = (ev.metadata ?? {}) as { workerName?: string; workerPhone?: string; latitude?: number; longitude?: number };
  return {
    provider: 'IFOOD',
    externalId: ev.orderId,
    status,
    at: ev.createdAt,
    courier: {
      name: m.workerName,
      phone: m.workerPhone,
      location: m.latitude != null && m.longitude != null ? { lat: m.latitude, lng: m.longitude } : undefined,
    },
    raw: ev,
  };
}
