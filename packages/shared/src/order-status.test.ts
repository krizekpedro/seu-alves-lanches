import { describe, expect, it } from 'vitest';
import { canTransition, slaStatus, stageDurations } from './order-status';
import { percentOf, toCents } from './money';

describe('máquina de estados do pedido', () => {
  it('segue o fluxo de entrega', () => {
    expect(canTransition('CRIADO', 'CONFIRMADO')).toBe(true);
    expect(canTransition('CONFIRMADO', 'EM_PREPARO')).toBe(true);
    expect(canTransition('EM_PREPARO', 'PRONTO')).toBe(true);
    expect(canTransition('PRONTO', 'SAIU_PARA_ENTREGA')).toBe(true);
    expect(canTransition('SAIU_PARA_ENTREGA', 'ENTREGUE')).toBe(true);
    expect(canTransition('ENTREGUE', 'CONCLUIDO')).toBe(true);
  });

  it('não pula etapas nem volta atrás', () => {
    expect(canTransition('CRIADO', 'PRONTO')).toBe(false);
    expect(canTransition('PRONTO', 'EM_PREPARO')).toBe(false);
    expect(canTransition('CONCLUIDO', 'CANCELADO')).toBe(false);
  });
});

describe('tempos por etapa', () => {
  const base = new Date('2026-11-27T21:00:00Z');
  const at = (m: number) => new Date(base.getTime() + m * 60000);

  it('mede as etapas do delivery', () => {
    const d = stageDurations(
      { createdAt: base, acceptedAt: at(2), readyAt: at(18), pickedUpAt: at(25), deliveredAt: at(39) },
      'ENTREGA',
    );
    expect(d).toEqual({ ACEITE: 2, PREPARO: 16, ESPERA_MOTOBOY: 7, ROTA: 14 });
  });

  it('mede as etapas do balcão', () => {
    const d = stageDurations({ createdAt: base, acceptedAt: at(1), readyAt: at(13), deliveredAt: at(15) }, 'BALCAO');
    expect(d).toEqual({ ACEITE: 1, PREPARO: 12, ENTREGA_BALCAO: 2 });
  });

  it('classifica contra a meta', () => {
    expect(slaStatus(15, 15)).toBe('ok');
    expect(slaStatus(17, 15)).toBe('atencao');
    expect(slaStatus(19, 15)).toBe('atrasado');
  });
});

describe('dinheiro em centavos', () => {
  it('converte e calcula percentuais sem erro de float', () => {
    expect(toCents(19.9)).toBe(1990);
    expect(percentOf(8000, 12)).toBe(960);
    expect(percentOf(2890, 3.2)).toBe(92);
  });
});
