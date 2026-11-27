import { Injectable } from '@nestjs/common';
import { OrderType, ServiceStage, slaStatus, stageDurations } from '@seu-alves/shared';
import { PrismaService } from '../common/prisma.service';

/** Tempos por etapa e gargalos (seção 1.10 do plano). */
@Injectable()
export class MetricsService {
  constructor(private readonly prisma: PrismaService) {}

  async stages(storeId: string, day: Date, flow: 'delivery' | 'balcao') {
    const start = new Date(day);
    start.setHours(0, 0, 0, 0);
    const end = new Date(start.getTime() + 86_400_000);
    const types: OrderType[] = flow === 'delivery' ? ['ENTREGA'] : ['BALCAO', 'RETIRADA', 'MESA'];
    const [orders, targets] = await Promise.all([
      this.prisma.order.findMany({
        where: { storeId, type: { in: types }, createdAt: { gte: start, lt: end }, status: { not: 'CANCELADO' } },
        select: { id: true, shortNumber: true, channel: true, type: true, createdAt: true, acceptedAt: true, readyAt: true, pickedUpAt: true, deliveredAt: true },
      }),
      this.prisma.serviceTarget.findMany({ where: { storeId, orderType: types[0], fromHour: null } }),
    ]);
    const targetBy = new Map(targets.map((t) => [t.stage, t.targetMinutes]));
    const acc = new Map<ServiceStage, number[]>();
    for (const o of orders) {
      const d = stageDurations(o, o.type);
      for (const [stage, v] of Object.entries(d) as [ServiceStage, number][]) {
        acc.set(stage, [...(acc.get(stage) ?? []), v]);
      }
    }
    const stages = [...acc.entries()].map(([stage, values]) => {
      const avg = values.reduce((a, b) => a + b, 0) / values.length;
      const target = targetBy.get(stage);
      const within = target ? Math.round((values.filter((v) => v <= target).length / values.length) * 100) : null;
      return { stage, avgMinutes: Math.round(avg * 10) / 10, targetMinutes: target ?? null, withinPct: within, status: target ? slaStatus(avg, target) : null, count: values.length };
    });
    return { day: start.toISOString().slice(0, 10), flow, orders: orders.length, stages };
  }
}
