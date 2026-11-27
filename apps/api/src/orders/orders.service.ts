import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@seu-alves/db';
import { CreateOrderInput, OrderStatus, STATUS_TIMESTAMP, canTransition } from '@seu-alves/shared';
import { PrismaService } from '../common/prisma.service';

type Tx = Prisma.TransactionClient;

@Injectable()
export class OrdersService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Cria um pedido de qualquer canal. Idempotente pelo id gerado na origem:
   * reenviar o mesmo pedido (ex.: sincronização do modo offline) devolve o já existente.
   * Os preços são sempre recalculados a partir do cadastro, nunca aceitos do cliente.
   */
  async create(input: CreateOrderInput, source = 'sistema', userId?: string) {
    const existing = await this.prisma.order.findUnique({ where: { id: input.id }, include: { items: { include: { options: true } } } });
    if (existing) {
      if (existing.storeId !== input.storeId) throw new ConflictException('Id de pedido já usado');
      return existing;
    }

    const productIds = [...new Set(input.items.map((i) => i.productId))];
    const optionIds = [...new Set(input.items.flatMap((i) => i.options.map((o) => o.optionId)))];
    const [products, options] = await Promise.all([
      this.prisma.product.findMany({ where: { id: { in: productIds }, storeId: input.storeId }, include: { channelPrices: true } }),
      this.prisma.option.findMany({ where: { id: { in: optionIds } }, include: { group: true } }),
    ]);
    const productById = new Map(products.map((p) => [p.id, p]));
    const optionById = new Map(options.map((o) => [o.id, o]));

    const items = input.items.map((i) => {
      const p = productById.get(i.productId);
      if (!p || !p.active) throw new BadRequestException(`Produto inexistente: ${i.productId}`);
      if (!p.available) throw new BadRequestException(`${p.name} está esgotado`);
      const unit = p.channelPrices.find((c) => c.channel === input.channel)?.priceCents ?? p.basePriceCents;
      const opts = i.options.map((o) => {
        const opt = optionById.get(o.optionId);
        if (!opt || !opt.active || opt.group.storeId !== input.storeId) throw new BadRequestException(`Adicional inválido: ${o.optionId}`);
        return { optionId: opt.id, name: opt.name, quantity: o.quantity, priceCents: opt.priceCents };
      });
      const optsTotal = opts.reduce((a, o) => a + o.priceCents * o.quantity, 0);
      return {
        productId: p.id,
        name: p.name,
        quantity: i.quantity,
        unitPriceCents: unit + optsTotal,
        totalCents: (unit + optsTotal) * i.quantity,
        note: i.note,
        options: opts,
      };
    });

    const subtotal = items.reduce((a, i) => a + i.totalCents, 0);
    if (input.discountStoreCents > subtotal) throw new BadRequestException('Desconto maior que o pedido');
    const total = subtotal + input.deliveryFeeCents - input.discountStoreCents;

    try {
      return await this.prisma.$transaction(async (tx) => {
        const shortNumber = await this.nextShortNumber(tx, input.storeId);
        const customerId = await this.resolveCustomer(tx, input);
        const order = await tx.order.create({
          data: {
            id: input.id,
            storeId: input.storeId,
            shortNumber,
            channel: input.channel,
            externalId: input.externalId,
            type: input.type,
            customerId,
            subtotalCents: subtotal,
            deliveryFeeCents: input.deliveryFeeCents,
            discountStoreCents: input.discountStoreCents,
            totalCents: total,
            note: input.note,
            items: {
              create: items.map(({ options: opts, ...rest }) => ({ ...rest, options: { create: opts } })),
            },
            history: { create: { from: null, to: 'CRIADO', source, userId } },
          },
          include: { items: { include: { options: true } } },
        });
        await tx.outboxEvent.create({
          data: { type: 'order.created', aggregateId: order.id, payload: { orderId: order.id, storeId: order.storeId, channel: order.channel } },
        });
        return order;
      });
    } catch (e) {
      // Duas requisições simultâneas com o mesmo id: a segunda devolve o pedido já gravado.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        const again = await this.prisma.order.findUnique({ where: { id: input.id }, include: { items: { include: { options: true } } } });
        if (again) return again;
      }
      throw e;
    }
  }

  /** Muda o status seguindo a máquina de estados e grava o horário da etapa. */
  async changeStatus(orderId: string, storeId: string, to: OrderStatus, source: string, userId?: string, reason?: string) {
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM orders WHERE id = ${orderId}::uuid FOR UPDATE`;
      if (!rows.length) throw new NotFoundException('Pedido não encontrado');
      const order = await tx.order.findUniqueOrThrow({ where: { id: orderId } });
      if (order.storeId !== storeId) throw new ForbiddenException();
      if (order.status === to) return order;
      if (!canTransition(order.status, to)) {
        throw new BadRequestException(`Não é possível passar de ${order.status} para ${to}`);
      }
      const now = new Date();
      const data: Prisma.OrderUpdateInput = { status: to };
      const tsField = STATUS_TIMESTAMP[to];
      if (tsField) (data as Record<string, unknown>)[tsField] = now;
      const updated = await tx.order.update({ where: { id: orderId }, data });
      await tx.orderStatusHistory.create({ data: { orderId, from: order.status, to, source, userId, reason, at: now } });
      await tx.outboxEvent.create({
        data: { type: 'order.status_changed', aggregateId: orderId, payload: { orderId, storeId, from: order.status, to } },
      });
      return updated;
    });
  }

  list(storeId: string, statuses?: OrderStatus[]) {
    return this.prisma.order.findMany({
      where: { storeId, ...(statuses?.length ? { status: { in: statuses } } : {}) },
      orderBy: { createdAt: 'asc' },
      include: { items: { include: { options: true } }, customer: { select: { name: true, phone: true } } },
      take: 200,
    });
  }

  /** Número curto do dia (senha), sequencial por loja; trava por loja evita números repetidos. */
  private async nextShortNumber(tx: Tx, storeId: string) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${storeId}))`;
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const last = await tx.order.findFirst({
      where: { storeId, createdAt: { gte: start } },
      orderBy: { shortNumber: 'desc' },
      select: { shortNumber: true },
    });
    return (last?.shortNumber ?? 0) + 1;
  }

  private async resolveCustomer(tx: Tx, input: CreateOrderInput) {
    if (!input.customer) return null;
    const store = await tx.store.findUniqueOrThrow({ where: { id: input.storeId }, select: { organizationId: true } });
    const phone = input.customer.phone?.replace(/\D/g, '') || null;
    const extra: { birthDate?: Date; marketingOptIn?: boolean; marketingOptInAt?: Date } = {};
    if (input.customer.birthDate) extra.birthDate = new Date(input.customer.birthDate + 'T00:00:00Z');
    if (input.customer.marketingOptIn) { extra.marketingOptIn = true; extra.marketingOptInAt = new Date(); }
    if (!phone) {
      const c = await tx.customer.create({ data: { organizationId: store.organizationId, name: input.customer.name, ...extra } });
      return c.id;
    }
    const c = await tx.customer.upsert({
      where: { organizationId_phone: { organizationId: store.organizationId, phone } },
      create: { organizationId: store.organizationId, name: input.customer.name, phone, ...extra },
      // só atualiza o que o cliente informou agora; nunca apaga um aceite com um pedido sem a caixa marcada
      update: extra,
    });
    return c.id;
  }
}
