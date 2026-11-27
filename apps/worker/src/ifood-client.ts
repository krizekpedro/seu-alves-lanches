/**
 * Cliente mínimo da Merchant API do iFood (aplicativo centralizado, OAuth2 client_credentials).
 * Endpoints conforme a documentação do iFood Developer; conferir no portal na homologação.
 */
export interface IfoodEvent {
  id: string;
  code: string; // PLC, CFM, RTP, DSP, CON, CAN...
  fullCode?: string;
  orderId: string;
  merchantId?: string;
  createdAt: string;
  /** Eventos de logística trazem dados do entregador aqui (nome, telefone, posição). */
  metadata?: Record<string, unknown>;
}

export interface IfoodConfig {
  baseUrl: string;
  clientId: string;
  clientSecret: string;
  merchantId: string;
}

type FetchLike = typeof fetch;

export class IfoodClient {
  private token: { value: string; expiresAt: number } | null = null;

  constructor(readonly cfg: IfoodConfig, private readonly http: FetchLike = fetch) {}

  /** Token em cache, renovado 60 s antes de expirar. */
  async accessToken(): Promise<string> {
    if (this.token && Date.now() < this.token.expiresAt - 60_000) return this.token.value;
    const body = new URLSearchParams({
      grantType: 'client_credentials',
      clientId: this.cfg.clientId,
      clientSecret: this.cfg.clientSecret,
    });
    const res = await this.http(`${this.cfg.baseUrl}/authentication/v1.0/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    if (!res.ok) throw new Error(`iFood auth falhou: HTTP ${res.status}`);
    const json = (await res.json()) as { accessToken: string; expiresIn: number };
    this.token = { value: json.accessToken, expiresAt: Date.now() + json.expiresIn * 1000 };
    return json.accessToken;
  }

  /** Chamada autenticada; usada também pelo adaptador de entregas (iFood Shipping). */
  async call(path: string, init: RequestInit = {}) {
    const token = await this.accessToken();
    const res = await this.http(`${this.cfg.baseUrl}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
    });
    if (res.status === 401) this.token = null;
    return res;
  }

  /** GET /events:polling — 204 quando não há eventos. Manter a cada 30 s deixa a loja aberta. */
  async poll(): Promise<IfoodEvent[]> {
    const res = await this.call('/order/v1.0/events:polling', { headers: { 'x-polling-merchants': this.cfg.merchantId } });
    if (res.status === 204) return [];
    if (!res.ok) throw new Error(`iFood polling falhou: HTTP ${res.status}`);
    return (await res.json()) as IfoodEvent[];
  }

  async acknowledge(eventIds: string[]): Promise<void> {
    if (!eventIds.length) return;
    const res = await this.call('/order/v1.0/events/acknowledgment', {
      method: 'POST',
      body: JSON.stringify(eventIds.map((id) => ({ id }))),
    });
    if (!res.ok) throw new Error(`iFood acknowledgment falhou: HTTP ${res.status}`);
  }

  async orderDetails(orderId: string): Promise<unknown> {
    const res = await this.call(`/order/v1.0/orders/${orderId}`);
    if (!res.ok) throw new Error(`iFood pedido ${orderId}: HTTP ${res.status}`);
    return res.json();
  }
}
