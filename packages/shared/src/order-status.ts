/**
 * Máquina de estados única do pedido, para todos os canais (seção 1.5 do plano).
 * Cada transição grava o horário da etapa, usado na tela de Tempos e gargalos (seção 1.10).
 */
export const ORDER_STATUSES = [
  'CRIADO',
  'CONFIRMADO',
  'EM_PREPARO',
  'PRONTO',
  'SAIU_PARA_ENTREGA',
  'RETIRADO',
  'ENTREGUE',
  'CONCLUIDO',
  'CANCELADO',
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const CHANNELS = ['IFOOD', 'CARDAPIO', 'WHATSAPP', 'BALCAO', 'OLACLICK'] as const;
export type Channel = (typeof CHANNELS)[number];

export const ORDER_TYPES = ['ENTREGA', 'RETIRADA', 'MESA', 'BALCAO'] as const;
export type OrderType = (typeof ORDER_TYPES)[number];

const TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  CRIADO: ['CONFIRMADO', 'CANCELADO'],
  CONFIRMADO: ['EM_PREPARO', 'CANCELADO'],
  EM_PREPARO: ['PRONTO', 'CANCELADO'],
  PRONTO: ['SAIU_PARA_ENTREGA', 'RETIRADO', 'ENTREGUE'],
  SAIU_PARA_ENTREGA: ['ENTREGUE'],
  RETIRADO: ['CONCLUIDO'],
  ENTREGUE: ['CONCLUIDO'],
  CONCLUIDO: [],
  CANCELADO: [],
};

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function nextStatuses(from: OrderStatus): OrderStatus[] {
  return [...TRANSITIONS[from]];
}

/** Coluna de horário gravada quando o pedido entra em cada status. */
export const STATUS_TIMESTAMP: Partial<Record<OrderStatus, string>> = {
  CONFIRMADO: 'acceptedAt',
  PRONTO: 'readyAt',
  SAIU_PARA_ENTREGA: 'pickedUpAt',
  RETIRADO: 'deliveredAt',
  ENTREGUE: 'deliveredAt',
  CONCLUIDO: 'concludedAt',
  CANCELADO: 'cancelledAt',
};

/** Etapas medidas na tela de tempos. */
export const SERVICE_STAGES = ['ACEITE', 'PREPARO', 'ESPERA_MOTOBOY', 'ROTA', 'ENTREGA_BALCAO'] as const;
export type ServiceStage = (typeof SERVICE_STAGES)[number];

export interface OrderTimestamps {
  createdAt: Date;
  acceptedAt?: Date | null;
  readyAt?: Date | null;
  pickedUpAt?: Date | null;
  deliveredAt?: Date | null;
}

/** Duração em minutos de cada etapa já concluída de um pedido. */
export function stageDurations(t: OrderTimestamps, type: OrderType): Partial<Record<ServiceStage, number>> {
  const min = (a?: Date | null, b?: Date | null) =>
    a && b ? Math.round(((b.getTime() - a.getTime()) / 60000) * 10) / 10 : undefined;
  const out: Partial<Record<ServiceStage, number>> = {};
  const set = (k: ServiceStage, v: number | undefined) => {
    if (v !== undefined) out[k] = v;
  };
  set('ACEITE', min(t.createdAt, t.acceptedAt));
  set('PREPARO', min(t.acceptedAt, t.readyAt));
  if (type === 'ENTREGA') {
    set('ESPERA_MOTOBOY', min(t.readyAt, t.pickedUpAt));
    set('ROTA', min(t.pickedUpAt, t.deliveredAt));
  } else {
    set('ENTREGA_BALCAO', min(t.readyAt, t.deliveredAt));
  }
  return out;
}

/** Verde dentro da meta, laranja até 20% acima, vermelho acima disso. */
export function slaStatus(minutes: number, targetMinutes: number): 'ok' | 'atencao' | 'atrasado' {
  if (minutes <= targetMinutes) return 'ok';
  if (minutes <= targetMinutes * 1.2) return 'atencao';
  return 'atrasado';
}
