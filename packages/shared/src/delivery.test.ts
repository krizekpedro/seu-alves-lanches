import { describe, expect, it } from 'vitest';
import { distanceMeters, nextDeliveryStatus, shouldNotifyArriving, suggestProvider, type DeliveryQuote } from './delivery';

const loja = { lat: -22.8496, lng: -43.3113 };

describe('nextDeliveryStatus', () => {
  it('ignora evento atrasado que voltaria a entrega para trás', () => {
    expect(nextDeliveryStatus('COLETADA', 'ENTREGADOR_ATRIBUIDO')).toBe('COLETADA');
    expect(nextDeliveryStatus('SOLICITADA', 'COLETADA')).toBe('COLETADA');
  });

  it('não muda depois de entregue ou cancelada', () => {
    expect(nextDeliveryStatus('ENTREGUE', 'CANCELADA')).toBe('ENTREGUE');
    expect(nextDeliveryStatus('CANCELADA', 'COLETADA')).toBe('CANCELADA');
  });

  it('volta a procurar entregador quando ele desiste antes da coleta', () => {
    expect(nextDeliveryStatus('ENTREGADOR_ATRIBUIDO', 'SOLICITADA')).toBe('SOLICITADA');
    expect(nextDeliveryStatus('COLETADA', 'SOLICITADA')).toBe('COLETADA');
  });
});

describe('shouldNotifyArriving', () => {
  const cliente = { lat: -22.8556, lng: -43.3113 }; // ~670 m ao sul

  it('não avisa o cliente só porque saiu para entrega', () => {
    const longe = { lat: -22.8796, lng: -43.3113 }; // ~3,3 km
    expect(shouldNotifyArriving({ status: 'COLETADA', courier: loja, destination: longe })).toBe(false);
    expect(shouldNotifyArriving({ status: 'COLETADA' })).toBe(false);
  });

  it('avisa quando o entregador entra no raio', () => {
    expect(distanceMeters(loja, cliente)).toBeGreaterThan(600);
    expect(distanceMeters(loja, cliente)).toBeLessThan(800);
    expect(shouldNotifyArriving({ status: 'COLETADA', courier: loja, destination: cliente })).toBe(true);
    expect(shouldNotifyArriving({ status: 'COLETADA', courier: loja, destination: cliente, radiusM: 500 })).toBe(false);
  });

  it('avisa uma vez só', () => {
    expect(shouldNotifyArriving({ status: 'CHEGANDO', alreadyNotified: true })).toBe(false);
    expect(shouldNotifyArriving({ status: 'CHEGANDO' })).toBe(true);
  });
});

describe('suggestProvider', () => {
  const quotes: DeliveryQuote[] = [
    { provider: 'IFOOD', feeCents: 990, pickupEtaMin: 8, dropoffEtaMin: 12 },
    { provider: 'N99', feeCents: 850, pickupEtaMin: 11, dropoffEtaMin: 12 },
  ];

  it('prefere o motoboy próprio livre', () => {
    const s = suggestProvider(quotes, { ownRidersFree: 1, enabled: ['PROPRIO', 'IFOOD', 'N99'] });
    expect(s?.provider).toBe('PROPRIO');
  });

  it('sem motoboy livre, escolhe o mais barato que chega a tempo', () => {
    expect(suggestProvider(quotes, { ownRidersFree: 0, enabled: ['PROPRIO', 'IFOOD', 'N99'] })?.provider).toBe('N99');
    expect(suggestProvider(quotes, { ownRidersFree: 0, enabled: ['IFOOD', 'N99'], maxPickupEtaMin: 10 })?.provider).toBe('IFOOD');
  });

  it('ignora provedor desligado e cotação vencida', () => {
    const now = new Date('2026-11-27T20:00:00Z');
    const q = [{ ...quotes[1], expiresAt: '2026-11-27T19:59:00Z' }, quotes[0]];
    expect(suggestProvider(q, { ownRidersFree: 0, enabled: ['IFOOD', 'N99'] }, now)?.provider).toBe('IFOOD');
    expect(suggestProvider(quotes, { ownRidersFree: 0, enabled: ['PROPRIO'] })).toBeNull();
  });
});
