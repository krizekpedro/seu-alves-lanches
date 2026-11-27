import type { DeliveryProvider, DeliveryQuote, DeliveryStatus, LatLng } from '@seu-alves/shared';

/** O que a loja manda para um provedor de entrega. */
export interface DeliveryRequest {
  orderId: string;
  shortNumber: number;
  /** Valor do pedido, para o seguro e o limite do provedor. */
  orderTotalCents: number;
  /** Pedido já pago (Pix/online). Terceirizados em geral não cobram na porta. */
  prepaid: boolean;
  pickup: { address: string; location: LatLng };
  dropoff: {
    customerName: string;
    customerPhone: string;
    street: string;
    number: string;
    complement?: string;
    neighborhood: string;
    city: string;
    state: string;
    postalCode?: string;
    reference?: string;
    location: LatLng;
  };
  items: { name: string; quantity: number; unitPriceCents: number }[];
  /** Cotação escolhida, quando o provedor exige cotar antes. */
  quoteId?: string;
}

/** Atualização normalizada vinda do provedor (resposta de consulta ou aviso automático). */
export interface DeliveryUpdate {
  provider: DeliveryProvider;
  externalId: string;
  status: DeliveryStatus;
  at: string;
  courier?: { name?: string; phone?: string; location?: LatLng };
  trackingUrl?: string;
  raw: unknown;
}

export interface DeliveryAdapter {
  readonly provider: DeliveryProvider;
  quote(req: DeliveryRequest): Promise<DeliveryQuote>;
  request(req: DeliveryRequest): Promise<{ externalId: string; status: DeliveryStatus; trackingUrl?: string }>;
  cancel(externalId: string, reason: string): Promise<void>;
  status(externalId: string): Promise<DeliveryUpdate>;
}

export type FetchLike = typeof fetch;
