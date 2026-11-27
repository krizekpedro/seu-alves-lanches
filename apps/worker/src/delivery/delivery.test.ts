import { describe, expect, it, vi } from 'vitest';
import { IfoodClient } from '../ifood-client';
import { IfoodShippingAdapter, ifoodEventToUpdate } from './ifood-shipping';
import { N99EntregaAdapter, n99PayloadToUpdate } from './n99-entrega';
import { mapN99Status } from './status-map';
import { applyDeliveryUpdate } from './sync';
import type { DeliveryRequest } from './types';

const req: DeliveryRequest = {
  orderId: '7a3f0c4e-0000-4000-8000-000000000001',
  shortNumber: 1053,
  orderTotalCents: 5390,
  prepaid: true,
  pickup: { address: 'Loja', location: { lat: -22.8496, lng: -43.3113 } },
  dropoff: {
    customerName: 'Cliente Teste',
    customerPhone: '21999990000',
    street: 'Rua Teste',
    number: '10',
    neighborhood: 'Vila Kosmos',
    city: 'Rio de Janeiro',
    state: 'RJ',
    location: { lat: -22.8556, lng: -43.3113 },
  },
  items: [{ name: 'X-Alves', quantity: 2, unitPriceCents: 2500 }],
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('iFood Entrega', () => {
  const http = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith('/oauth/token')) return json({ accessToken: 'tok', expiresIn: 3600 });
    if (url.includes('/deliveryAvailabilities')) return json({ id: 'q1', quote: { netValue: 9.9 }, pickupTime: { max: 480 }, deliveryTime: { max: 720 }, expirationAt: '2026-11-27T23:59:00Z' });
    if (url.endsWith('/merchants/m1/orders') && init?.method === 'POST') return json({ id: 'ship-1', trackingUrl: 'https://t' }, 202);
    return new Response(null, { status: 404 });
  });
  const client = new IfoodClient({ baseUrl: 'https://ifood.test', clientId: 'id', clientSecret: 's', merchantId: 'm1' }, http as unknown as typeof fetch);
  const ifood = new IfoodShippingAdapter(client);

  it('cota em centavos e minutos', async () => {
    const q = await ifood.quote(req);
    expect(q).toMatchObject({ provider: 'IFOOD', feeCents: 990, pickupEtaMin: 8, dropoffEtaMin: 12, externalQuoteId: 'q1' });
  });

  it('solicita com chave de idempotência e o endereço com coordenadas', async () => {
    const r = await ifood.request({ ...req, quoteId: 'q1' });
    expect(r).toEqual({ externalId: 'ship-1', status: 'SOLICITADA', trackingUrl: 'https://t' });
    const call = http.mock.calls.find(([u, i]) => String(u).endsWith('/orders') && i?.method === 'POST')!;
    expect((call[1]!.headers as Record<string, string>)['Idempotency-Key']).toBe(`entrega-${req.orderId}`);
    const body = JSON.parse(String(call[1]!.body));
    expect(body.delivery.deliveryAddress.coordinates).toEqual({ latitude: -22.8556, longitude: -43.3113 });
    expect(body.payments.methods[0]).toMatchObject({ type: 'ONLINE', value: 53.9 });
  });

  it('traduz eventos de logística e ignora os de pedido', () => {
    expect(ifoodEventToUpdate({ code: 'AAO', fullCode: 'ARRIVED_AT_ORIGIN', orderId: 'o1', createdAt: 'x' })?.status).toBe('NA_LOJA');
    expect(ifoodEventToUpdate({ code: 'PLC', fullCode: 'PLACED', orderId: 'o1', createdAt: 'x' })).toBeNull();
  });
});

describe('99 Entrega', () => {
  const http = vi.fn(async (url: string) => {
    if (url.endsWith('/oauth/token')) return json({ access_token: 'tok', expires_in: 3600 });
    if (url.endsWith('/deliveries/estimate')) return json({ id: 'e1', price: 8.5, pickup_eta: 11, dropoff_eta: 13 });
    if (url.endsWith('/deliveries')) return json({ id: 'd1', status: 'searching_driver' }, 201);
    if (url.endsWith('/deliveries/d1/cancel')) return new Response(null, { status: 204 });
    if (url.endsWith('/deliveries/d1')) return json({ id: 'd1', status: 'picked_up', driver: { name: 'Carlos', latitude: -22.85, longitude: -43.31 } });
    return new Response(null, { status: 404 });
  });
  const n99 = new N99EntregaAdapter({ baseUrl: 'https://99.test', clientId: 'id', clientSecret: 's' }, http as unknown as typeof fetch);

  it('cobre os 5 testes exigidos: cotar, criar, cancelar, consultar e aviso automático', async () => {
    expect(await n99.quote(req)).toMatchObject({ feeCents: 850, pickupEtaMin: 11, dropoffEtaMin: 13 });
    expect(await n99.request(req)).toMatchObject({ externalId: 'd1', status: 'SOLICITADA' });
    await expect(n99.cancel('d1', 'cliente desistiu')).resolves.toBeUndefined();
    const st = await n99.status('d1');
    expect(st).toMatchObject({ status: 'COLETADA', courier: { name: 'Carlos', location: { lat: -22.85, lng: -43.31 } } });
    expect(n99PayloadToUpdate({ event: 'delivery.delivered', data: { id: 'd1' } })?.status).toBe('ENTREGUE');
  });

  it('entende os nomes de status mais comuns', () => {
    expect(mapN99Status('DRIVER_ACCEPTED')).toBe('ENTREGADOR_ATRIBUIDO');
    expect(mapN99Status('arrived_at_pickup')).toBe('NA_LOJA');
    expect(mapN99Status('arriving')).toBe('CHEGANDO');
    expect(mapN99Status('no_driver_found')).toBe('FALHOU');
    expect(mapN99Status('canceled_by_merchant')).toBe('CANCELADA');
    expect(mapN99Status('qualquer_coisa')).toBeNull();
  });
});

describe('applyDeliveryUpdate', () => {
  function fakeDb(start: Record<string, unknown>) {
    const row = {
      id: 'del1', orderId: 'ord1', provider: 'N99', status: 'ENTREGADOR_ATRIBUIDO', courierName: null, courierLat: null, courierLng: null,
      destLat: -22.8556, destLng: -43.3113, trackingUrl: null, customerNotifiedAt: null,
      order: { store: { notifyRadiusM: 800 } },
      ...start,
    };
    const outbox: { type: string }[] = [];
    const db = {
      delivery: {
        findUnique: vi.fn(async () => row),
        update: vi.fn((args: { data: Record<string, unknown> }) => Object.assign(row, args.data)),
      },
      outboxEvent: { create: vi.fn((args: { data: { type: string } }) => outbox.push(args.data)) },
      $transaction: vi.fn(async (ops: unknown[]) => ops),
    };
    return { db, row, outbox };
  }

  it('saiu para entrega é só interno: não avisa o cliente longe', async () => {
    const { db, outbox } = fakeDb({});
    await applyDeliveryUpdate(db as never, { provider: 'N99', externalId: 'd1', status: 'COLETADA', at: '2026-11-27T21:58:00Z', courier: { location: { lat: -22.88, lng: -43.31 } }, raw: {} });
    expect(outbox.map((e) => e.type)).toEqual(['delivery.status_changed']);
  });

  it('avisa o cliente uma vez quando o entregador entra no raio', async () => {
    const { db, outbox, row } = fakeDb({ status: 'COLETADA' });
    const near = { provider: 'N99' as const, externalId: 'd1', status: 'COLETADA' as const, at: 'x', courier: { location: { lat: -22.8530, lng: -43.3113 } }, raw: {} };
    await applyDeliveryUpdate(db as never, near);
    expect(outbox.map((e) => e.type)).toEqual(['customer.notify_arriving']);
    expect(row.customerNotifiedAt).toBeInstanceOf(Date);
    await applyDeliveryUpdate(db as never, near);
    expect(outbox).toHaveLength(1);
  });

  it('grava a hora em que o entregador chegou na loja e alerta quando falha', async () => {
    const { db, row, outbox } = fakeDb({});
    await applyDeliveryUpdate(db as never, { provider: 'N99', externalId: 'd1', status: 'NA_LOJA', at: '2026-11-27T21:50:00Z', raw: {} });
    expect(row.arrivedStoreAt).toEqual(new Date('2026-11-27T21:50:00Z'));
    const f = fakeDb({});
    await applyDeliveryUpdate(f.db as never, { provider: 'N99', externalId: 'd1', status: 'FALHOU', at: 'x', raw: {} });
    expect(f.outbox.map((e) => e.type)).toEqual(['delivery.status_changed', 'delivery.failed']);
    expect(outbox[0].type).toBe('delivery.status_changed');
  });
});
