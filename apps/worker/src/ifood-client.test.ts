import { describe, expect, it, vi } from 'vitest';
import { IfoodClient } from './ifood-client';

const cfg = { baseUrl: 'https://ifood.test', clientId: 'id', clientSecret: 'secret', merchantId: 'm1' };

function fakeFetch() {
  return vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith('/oauth/token')) return new Response(JSON.stringify({ accessToken: 'tok', expiresIn: 3600 }), { status: 200 });
    if (url.endsWith('/events:polling')) {
      expect((init?.headers as Record<string, string>)['x-polling-merchants']).toBe('m1');
      return new Response(JSON.stringify([{ id: 'e1', code: 'PLC', orderId: 'o1', createdAt: '' }]), { status: 200 });
    }
    if (url.endsWith('/events/acknowledgment')) return new Response(null, { status: 202 });
    return new Response(null, { status: 404 });
  });
}

describe('IfoodClient', () => {
  it('reaproveita o token entre chamadas', async () => {
    const http = fakeFetch();
    const c = new IfoodClient(cfg, http as unknown as typeof fetch);
    await c.poll();
    await c.poll();
    const authCalls = http.mock.calls.filter(([u]) => String(u).endsWith('/oauth/token'));
    expect(authCalls).toHaveLength(1);
  });

  it('faz polling com o merchant e confirma os eventos', async () => {
    const http = fakeFetch();
    const c = new IfoodClient(cfg, http as unknown as typeof fetch);
    const evs = await c.poll();
    expect(evs.map((e) => e.code)).toEqual(['PLC']);
    await c.acknowledge(evs.map((e) => e.id));
    const ack = http.mock.calls.find(([u]) => String(u).endsWith('/events/acknowledgment'));
    expect(JSON.parse(String(ack?.[1]?.body))).toEqual([{ id: 'e1' }]);
  });
});
