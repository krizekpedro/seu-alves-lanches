import type { DeliveryStatus } from '@seu-alves/shared';

/**
 * Códigos de logística do iFood (eventos do /events:polling ou do webhook).
 * Conferir a lista completa no portal durante a homologação; código desconhecido é ignorado e fica no log.
 */
export const IFOOD_DELIVERY_CODES: Record<string, DeliveryStatus> = {
  REQUEST_DRIVER: 'SOLICITADA',
  REQUEST_DRIVER_SUCCESS: 'SOLICITADA',
  REQUEST_DRIVER_FAILED: 'FALHOU',
  ASSIGN_DRIVER: 'ENTREGADOR_ATRIBUIDO',
  ADR: 'ENTREGADOR_ATRIBUIDO',
  GOING_TO_ORIGIN: 'ENTREGADOR_ATRIBUIDO',
  GTO: 'ENTREGADOR_ATRIBUIDO',
  ARRIVED_AT_ORIGIN: 'NA_LOJA',
  AAO: 'NA_LOJA',
  COLLECTED: 'COLETADA',
  CLT: 'COLETADA',
  DISPATCHED: 'COLETADA',
  DSP: 'COLETADA',
  ARRIVED_AT_DESTINATION: 'CHEGANDO',
  AAD: 'CHEGANDO',
  DELIVERED: 'ENTREGUE',
  CONCLUDED: 'ENTREGUE',
  CON: 'ENTREGUE',
  CANCELLED: 'CANCELADA',
  CAN: 'CANCELADA',
  DELIVERY_CANCELLATION_REQUESTED: 'CANCELADA',
};

/**
 * A documentação da 99 Entrega só é liberada com a conta de desenvolvedor.
 * Até lá, traduzimos o status pelo significado das palavras, o que cobre os nomes usuais
 * (accepted, arrived_pickup, picked_up, arriving, delivered...). Quando a lista oficial chegar,
 * basta preencher N99_EXACT e ela passa a valer primeiro.
 */
export const N99_EXACT: Record<string, DeliveryStatus> = {};

const RULES: [RegExp, DeliveryStatus][] = [
  [/cancel/, 'CANCELADA'],
  [/(fail|expired|no_?driver|rejected|unavailable)/, 'FALHOU'],
  [/(delivered|finished|completed|concluded|done)/, 'ENTREGUE'],
  [/(arriv\w*_?(at_)?(dest|drop|customer)|arriving|near)/, 'CHEGANDO'],
  [/(picked|collected|on_?route|in_?transit|dispatched|delivering)/, 'COLETADA'],
  [/(arriv\w*_?(at_)?(pickup|origin|store|merchant))/, 'NA_LOJA'],
  [/(accepted|assigned|going_?to_?(pickup|origin)|driver_?found)/, 'ENTREGADOR_ATRIBUIDO'],
  [/(created|requested|searching|pending|waiting)/, 'SOLICITADA'],
];

export function mapN99Status(raw: string): DeliveryStatus | null {
  if (N99_EXACT[raw]) return N99_EXACT[raw];
  const s = raw.trim().toLowerCase().replace(/[\s-]+/g, '_');
  for (const [re, status] of RULES) if (re.test(s)) return status;
  return null;
}
