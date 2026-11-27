import type { DeliveryQuote } from '@seu-alves/shared';
import { mapN99Status } from './status-map';
import type { DeliveryAdapter, DeliveryRequest, DeliveryUpdate, FetchLike } from './types';

/**
 * 99 Entrega (entregador da 99 para pedidos da loja).
 * A 99 libera a documentação da API junto com a conta de desenvolvedor, e exige 5 testes para produção:
 * cotar, criar, cancelar, consultar e receber o aviso automático (webhook). Este adaptador cobre os cinco.
 *
 * Como os caminhos e nomes de campo só ficam visíveis com a conta, eles vêm de configuração
 * (N99_PATH_* no .env). Os valores padrão abaixo são o formato mais comum e devem ser conferidos
 * com a documentação recebida antes de ligar.
 */
export interface N99Config {
  baseUrl: string;
  clientId: string;
  clientSecret: string;
  paths?: Partial<typeof DEFAULT_N99_PATHS>;
}

export const DEFAULT_N99_PATHS = {
  token: '/oauth/token',
  quote: '/deliveries/estimate',
  create: '/deliveries',
  get: '/deliveries/{id}',
  cancel: '/deliveries/{id}/cancel',
};

const reais = (c: number) => Math.round(c) / 100;
const num = (v: unknown) => (typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : undefined);

/** Lê o primeiro campo existente entre vários nomes possíveis. */
function pick(obj: unknown, ...keys: string[]): unknown {
  for (const k of keys) {
    let cur: unknown = obj;
    for (const part of k.split('.')) cur = cur && typeof cur === 'object' ? (cur as Record<string, unknown>)[part] : undefined;
    if (cur !== undefined && cur !== null) return cur;
  }
  return undefined;
}

export class N99EntregaAdapter implements DeliveryAdapter {
  readonly provider = 'N99' as const;
  private token: { value: string; expiresAt: number } | null = null;
  private readonly paths: typeof DEFAULT_N99_PATHS;

  constructor(private readonly cfg: N99Config, private readonly http: FetchLike = fetch) {
    this.paths = { ...DEFAULT_N99_PATHS, ...(cfg.paths ?? {}) };
  }

  private path(name: keyof typeof DEFAULT_N99_PATHS, id?: string) {
    return `${this.cfg.baseUrl}${this.paths[name].replace('{id}', encodeURIComponent(id ?? ''))}`;
  }

  async accessToken(): Promise<string> {
    if (this.token && Date.now() < this.token.expiresAt - 60_000) return this.token.value;
    const res = await this.http(this.path('token'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'client_credentials', client_id: this.cfg.clientId, client_secret: this.cfg.clientSecret }),
    });
    if (!res.ok) throw new Error(`99 Entrega auth falhou: HTTP ${res.status}`);
    const json = (await res.json()) as Record<string, unknown>;
    const value = String(pick(json, 'access_token', 'accessToken', 'token'));
    const ttl = num(pick(json, 'expires_in', 'expiresIn')) ?? 3600;
    this.token = { value, expiresAt: Date.now() + ttl * 1000 };
    return value;
  }

  private async call(url: string, init: RequestInit = {}) {
    const token = await this.accessToken();
    const res = await this.http(url, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
    });
    if (res.status === 401) this.token = null;
    if (!res.ok && res.status !== 202) throw new Error(`99 Entrega: HTTP ${res.status} em ${url.replace(this.cfg.baseUrl, '')}`);
    return res.status === 204 ? {} : ((await res.json().catch(() => ({}))) as Record<string, unknown>);
  }

  private body(req: DeliveryRequest) {
    const d = req.dropoff;
    return {
      external_id: req.orderId,
      reference: `#${req.shortNumber}`,
      pickup: { address: req.pickup.address, latitude: req.pickup.location.lat, longitude: req.pickup.location.lng },
      dropoff: {
        name: d.customerName,
        phone: `+55${d.customerPhone}`,
        address: `${d.street}, ${d.number}${d.complement ? ` - ${d.complement}` : ''} - ${d.neighborhood}, ${d.city} - ${d.state}`,
        reference: d.reference,
        latitude: d.location.lat,
        longitude: d.location.lng,
      },
      package: { value: reais(req.orderTotalCents), description: req.items.map((i) => `${i.quantity}x ${i.name}`).join(', ') },
    };
  }

  async quote(req: DeliveryRequest): Promise<DeliveryQuote> {
    const r = await this.call(this.path('quote'), { method: 'POST', body: JSON.stringify(this.body(req)) });
    const fee = num(pick(r, 'price', 'fee', 'amount', 'estimate.price', 'total'));
    return {
      provider: 'N99',
      externalQuoteId: pick(r, 'id', 'quote_id', 'estimate_id') as string | undefined,
      // a 99 costuma responder em reais; se vier inteiro grande, já são centavos
      feeCents: fee == null ? 0 : fee > 500 && Number.isInteger(fee) ? fee : Math.round(fee * 100),
      pickupEtaMin: Math.ceil(num(pick(r, 'pickup_eta', 'pickup_eta_minutes', 'eta.pickup')) ?? 10),
      dropoffEtaMin: Math.ceil(num(pick(r, 'dropoff_eta', 'delivery_eta', 'eta_minutes', 'eta.dropoff')) ?? 15),
      expiresAt: pick(r, 'expires_at', 'expiresAt') as string | undefined,
    };
  }

  async request(req: DeliveryRequest) {
    const r = await this.call(this.path('create'), {
      method: 'POST',
      headers: { 'Idempotency-Key': `entrega-${req.orderId}` },
      body: JSON.stringify({ ...this.body(req), quote_id: req.quoteId }),
    });
    return {
      externalId: String(pick(r, 'id', 'delivery_id', 'order_id')),
      status: mapN99Status(String(pick(r, 'status') ?? 'requested')) ?? ('SOLICITADA' as const),
      trackingUrl: pick(r, 'tracking_url', 'trackingUrl', 'share_url') as string | undefined,
    };
  }

  async cancel(externalId: string, reason: string) {
    await this.call(this.path('cancel', externalId), { method: 'POST', body: JSON.stringify({ reason }) });
  }

  async status(externalId: string): Promise<DeliveryUpdate> {
    const r = await this.call(this.path('get', externalId));
    return n99PayloadToUpdate(r, externalId) ?? { provider: 'N99', externalId, status: 'SOLICITADA', at: new Date().toISOString(), raw: r };
  }
}

/** Corpo da consulta ou do aviso automático (webhook) da 99 → atualização normalizada. */
export function n99PayloadToUpdate(payload: unknown, fallbackId?: string): DeliveryUpdate | null {
  const rawStatus = pick(payload, 'status', 'event', 'data.status', 'delivery.status');
  const status = rawStatus == null ? null : mapN99Status(String(rawStatus));
  const externalId = pick(payload, 'id', 'delivery_id', 'data.id', 'delivery.id') ?? fallbackId;
  if (!status || externalId == null) return null;
  const lat = num(pick(payload, 'driver.latitude', 'driver.location.lat', 'courier.latitude', 'data.driver.latitude'));
  const lng = num(pick(payload, 'driver.longitude', 'driver.location.lng', 'courier.longitude', 'data.driver.longitude'));
  return {
    provider: 'N99',
    externalId: String(externalId),
    status,
    at: String(pick(payload, 'updated_at', 'timestamp', 'occurred_at') ?? new Date().toISOString()),
    courier: {
      name: pick(payload, 'driver.name', 'courier.name', 'data.driver.name') as string | undefined,
      phone: pick(payload, 'driver.phone', 'courier.phone', 'data.driver.phone') as string | undefined,
      location: lat != null && lng != null ? { lat, lng } : undefined,
    },
    trackingUrl: pick(payload, 'tracking_url', 'share_url') as string | undefined,
    raw: payload,
  };
}
