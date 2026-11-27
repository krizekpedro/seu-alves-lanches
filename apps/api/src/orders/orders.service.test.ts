/**
 * Teste de integração do núcleo de pedidos contra um PostgreSQL real.
 * Roda só quando DATABASE_URL aponta para um banco de teste (ex.: no CI).
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@seu-alves/db';
import { OrdersService } from './orders.service';
import type { PrismaService } from '../common/prisma.service';

const run = process.env.DATABASE_URL ? describe : describe.skip;

run('OrdersService (integração)', () => {
  const prisma = new PrismaClient();
  const service = new OrdersService(prisma as unknown as PrismaService);
  let storeId: string;
  let productId: string;
  let optionId: string;

  beforeAll(async () => {
    const org = await prisma.organization.create({ data: { name: 'Teste' } });
    const store = await prisma.store.create({ data: { organizationId: org.id, name: 'Loja teste' } });
    storeId = store.id;
    const cat = await prisma.category.create({ data: { storeId, name: 'Hambúrgueres' } });
    const product = await prisma.product.create({ data: { storeId, categoryId: cat.id, name: 'X-Alves', basePriceCents: 2500 } });
    productId = product.id;
    await prisma.channelPrice.create({ data: { productId, channel: 'IFOOD', priceCents: 2890 } });
    const group = await prisma.optionGroup.create({ data: { storeId, name: 'Adicionais', max: 3, options: { create: [{ name: 'Bacon', priceCents: 400 }] } }, include: { options: true } });
    optionId = group.options[0].id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('calcula o total pelo cadastro e é idempotente', async () => {
    const id = randomUUID();
    const input = {
      id, storeId, channel: 'BALCAO' as const, type: 'BALCAO' as const,
      customer: { name: 'Maria', phone: '(21) 99999-0000' },
      items: [{ productId, quantity: 2, options: [{ optionId, quantity: 1 }] }],
      deliveryFeeCents: 0, discountStoreCents: 0,
    };
    const a = await service.create(input);
    const b = await service.create(input);
    expect(b.id).toBe(a.id);
    expect(a.subtotalCents).toBe(2 * (2500 + 400));
    expect(a.totalCents).toBe(5800);
    expect(await prisma.order.count({ where: { id } })).toBe(1);
    expect(await prisma.outboxEvent.count({ where: { aggregateId: id, type: 'order.created' } })).toBe(1);
  });

  it('usa o preço do canal (iFood) quando existe', async () => {
    const o = await service.create({
      id: randomUUID(), storeId, channel: 'IFOOD', type: 'ENTREGA',
      items: [{ productId, quantity: 1, options: [] }], deliveryFeeCents: 500, discountStoreCents: 0,
    });
    expect(o.subtotalCents).toBe(2890);
    expect(o.totalCents).toBe(3390);
  });

  it('numera os pedidos do dia em sequência, mesmo em paralelo', async () => {
    const mk = () => service.create({
      id: randomUUID(), storeId, channel: 'BALCAO', type: 'BALCAO',
      items: [{ productId, quantity: 1, options: [] }], deliveryFeeCents: 0, discountStoreCents: 0,
    });
    const orders = await Promise.all([mk(), mk(), mk(), mk()]);
    const nums = orders.map((o) => o.shortNumber).sort((x, y) => x - y);
    expect(new Set(nums).size).toBe(4);
    expect(nums[3] - nums[0]).toBe(3);
  });

  it('segue a máquina de estados e grava os horários de cada etapa', async () => {
    const o = await service.create({
      id: randomUUID(), storeId, channel: 'CARDAPIO', type: 'ENTREGA',
      items: [{ productId, quantity: 1, options: [] }], deliveryFeeCents: 500, discountStoreCents: 0,
    });
    await expect(service.changeStatus(o.id, storeId, 'PRONTO', 'cozinha')).rejects.toThrow(/Não é possível/);
    await service.changeStatus(o.id, storeId, 'CONFIRMADO', 'cozinha');
    await service.changeStatus(o.id, storeId, 'EM_PREPARO', 'cozinha');
    await service.changeStatus(o.id, storeId, 'PRONTO', 'cozinha');
    await service.changeStatus(o.id, storeId, 'SAIU_PARA_ENTREGA', 'motoboy');
    const done = await service.changeStatus(o.id, storeId, 'ENTREGUE', 'motoboy');
    expect(done.acceptedAt).toBeTruthy();
    expect(done.readyAt).toBeTruthy();
    expect(done.pickedUpAt).toBeTruthy();
    expect(done.deliveredAt).toBeTruthy();
    expect(await prisma.orderStatusHistory.count({ where: { orderId: o.id } })).toBe(6);
  });

  it('recusa produto esgotado', async () => {
    await prisma.product.update({ where: { id: productId }, data: { available: false } });
    await expect(service.create({
      id: randomUUID(), storeId, channel: 'BALCAO', type: 'BALCAO',
      items: [{ productId, quantity: 1, options: [] }], deliveryFeeCents: 0, discountStoreCents: 0,
    })).rejects.toThrow(/esgotado/);
    await prisma.product.update({ where: { id: productId }, data: { available: true } });
  });
  it('guarda aniversário e aceite de promoções sem desfazer o aceite depois', async () => {
    const phone = '(21) 98888-' + String(Date.now()).slice(-4);
    const base = { storeId, channel: 'CARDAPIO' as const, type: 'RETIRADA' as const, items: [{ productId, quantity: 1, options: [] }], deliveryFeeCents: 0, discountStoreCents: 0 };
    await service.create({ ...base, id: randomUUID(), customer: { name: 'Ana', phone, birthDate: '1990-03-12', marketingOptIn: true } });
    await service.create({ ...base, id: randomUUID(), customer: { name: 'Ana', phone } });
    const c = await prisma.customer.findFirstOrThrow({ where: { phone: phone.replace(/\D/g, '') } });
    expect(c.birthDate?.toISOString().slice(0, 10)).toBe('1990-03-12');
    expect(c.marketingOptIn).toBe(true);
    expect(c.marketingOptInAt).toBeTruthy();
  });
});
