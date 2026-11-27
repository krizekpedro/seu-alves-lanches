/**
 * Entregas: motoboy próprio, iFood Entrega (Shipping / sob demanda) e 99 Entrega.
 * Cada provedor é um adaptador (apps/worker/src/delivery) que traduz o status dele para o status único abaixo.
 * Aqui ficam só regras puras: escolha do provedor, quando avisar o cliente e cálculo de distância.
 */

export const DELIVERY_PROVIDERS = ['PROPRIO', 'IFOOD', 'N99'] as const;
export type DeliveryProvider = (typeof DELIVERY_PROVIDERS)[number];

export const DELIVERY_PROVIDER_LABEL: Record<DeliveryProvider, string> = {
  PROPRIO: 'Motoboy próprio',
  IFOOD: 'iFood Entrega',
  N99: '99 Entrega',
};

/** Status único da entrega, igual para todos os provedores. */
export const DELIVERY_STATUSES = [
  'COTADA',
  'SOLICITADA', // pedido de entregador enviado, aguardando alguém aceitar
  'ENTREGADOR_ATRIBUIDO', // alguém aceitou e está indo para a loja
  'NA_LOJA',
  'COLETADA', // saiu para entrega (interno: o cliente não é avisado aqui)
  'CHEGANDO', // entrou no raio de aviso: só agora o cliente é avisado
  'ENTREGUE',
  'CANCELADA',
  'FALHOU', // ninguém aceitou ou o provedor recusou
] as const;
export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];

export const DELIVERY_FINAL: DeliveryStatus[] = ['ENTREGUE', 'CANCELADA', 'FALHOU'];

const ORDER: Record<DeliveryStatus, number> = {
  COTADA: 0,
  SOLICITADA: 1,
  ENTREGADOR_ATRIBUIDO: 2,
  NA_LOJA: 3,
  COLETADA: 4,
  CHEGANDO: 5,
  ENTREGUE: 6,
  CANCELADA: 6,
  FALHOU: 6,
};

/**
 * Os provedores podem mandar eventos fora de ordem ou repetidos.
 * Só avança: nunca volta de COLETADA para ENTREGADOR_ATRIBUIDO, e nada muda depois de um status final.
 * A exceção é voltar para SOLICITADA quando o entregador desiste antes da coleta (o provedor procura outro).
 */
export function nextDeliveryStatus(current: DeliveryStatus, incoming: DeliveryStatus): DeliveryStatus {
  if (DELIVERY_FINAL.includes(current)) return current;
  if (incoming === 'SOLICITADA' && (current === 'ENTREGADOR_ATRIBUIDO' || current === 'NA_LOJA')) return incoming;
  return ORDER[incoming] > ORDER[current] ? incoming : current;
}

export interface LatLng {
  lat: number;
  lng: number;
}

/** Distância em metros (fórmula de Haversine). */
export function distanceMeters(a: LatLng, b: LatLng): number {
  const R = 6_371_000;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(h)));
}

export const DEFAULT_NOTIFY_RADIUS_M = 800;

/**
 * Regra do Krizek: "saiu para entrega" é interno. O cliente só recebe o aviso quando o entregador
 * está a menos do raio configurado (padrão 800 m) ou quando o provedor já diz que está chegando.
 */
export function shouldNotifyArriving(input: {
  status: DeliveryStatus;
  courier?: LatLng | null;
  destination?: LatLng | null;
  radiusM?: number;
  alreadyNotified?: boolean;
}): boolean {
  if (input.alreadyNotified) return false;
  if (input.status === 'CHEGANDO') return true;
  if (input.status !== 'COLETADA' || !input.courier || !input.destination) return false;
  return distanceMeters(input.courier, input.destination) <= (input.radiusM ?? DEFAULT_NOTIFY_RADIUS_M);
}

export interface DeliveryQuote {
  provider: DeliveryProvider;
  feeCents: number;
  /** Minutos até o entregador chegar na loja. */
  pickupEtaMin: number;
  /** Minutos da loja até o cliente. */
  dropoffEtaMin: number;
  /** Até quando a cotação vale (os provedores expiram a cotação em poucos minutos). */
  expiresAt?: string;
  externalQuoteId?: string;
}

export interface DispatchRules {
  /** Motoboys próprios livres agora. */
  ownRidersFree: number;
  /** Provedores ligados nas configurações, em ordem de preferência. */
  enabled: DeliveryProvider[];
  /** Se a cotação mais barata chegar depois disso, prefere a mais rápida. */
  maxPickupEtaMin?: number;
}

/**
 * Sugestão de quem leva o pedido. A loja confirma com um toque (ou liga o automático).
 * 1. Motoboy próprio livre sempre vem primeiro (sem taxa extra).
 * 2. Entre os terceirizados, a mais barata que chega na loja dentro do limite.
 * 3. Se nenhuma chega a tempo, a que chega mais rápido.
 */
export function suggestProvider(quotes: DeliveryQuote[], rules: DispatchRules, now = new Date()): DeliveryQuote | null {
  if (rules.enabled.includes('PROPRIO') && rules.ownRidersFree > 0) {
    return { provider: 'PROPRIO', feeCents: 0, pickupEtaMin: 0, dropoffEtaMin: quotes[0]?.dropoffEtaMin ?? 0 };
  }
  const valid = quotes.filter(
    (q) => q.provider !== 'PROPRIO' && rules.enabled.includes(q.provider) && (!q.expiresAt || new Date(q.expiresAt) > now),
  );
  if (!valid.length) return null;
  const limit = rules.maxPickupEtaMin ?? 15;
  const inTime = valid.filter((q) => q.pickupEtaMin <= limit);
  if (inTime.length) {
    return inTime.reduce((best, q) =>
      q.feeCents < best.feeCents || (q.feeCents === best.feeCents && q.pickupEtaMin < best.pickupEtaMin) ? q : best,
    );
  }
  return valid.reduce((best, q) => (q.pickupEtaMin < best.pickupEtaMin ? q : best));
}
