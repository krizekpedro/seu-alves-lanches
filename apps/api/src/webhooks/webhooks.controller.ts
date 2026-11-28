import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { Controller, ForbiddenException, Headers, HttpCode, NotFoundException, Param, Post, Query, Req } from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { PrismaService } from '../common/prisma.service';

function safeEqual(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/**
 * Avisos automáticos dos provedores (regra de ouro do plano, seção 1.3):
 * confere a assinatura, grava o corpo cru em inbound_events e responde 200 na hora.
 * O worker processa depois (apps/worker/src/delivery/webhooks.ts); aviso repetido é ignorado.
 *
 * - iFood: assinatura HMAC-SHA256 do corpo com o client secret, no cabeçalho X-IFood-Signature.
 * - 99 Entrega: URL cadastrada no portal da 99 com ?token=<N99_WEBHOOK_TOKEN>
 *   (ou cabeçalho x-signature com HMAC do corpo, se a 99 assinar).
 */
@Controller('webhooks')
export class WebhooksController {
  constructor(private readonly prisma: PrismaService) {}

  @Post(':provider')
  @HttpCode(200)
  async receive(
    @Param('provider') provider: string,
    @Req() req: RawBodyRequest<Request>,
    @Headers() headers: Record<string, string | undefined>,
    @Query('token') token?: string,
  ) {
    const raw = req.rawBody ?? Buffer.from(JSON.stringify(req.body ?? {}));
    if (provider === 'ifood') {
      const secret = process.env.IFOOD_CLIENT_SECRET;
      const sig = headers['x-ifood-signature'];
      if (!secret || !sig || !safeEqual(createHmac('sha256', secret).update(raw).digest('hex'), sig)) throw new ForbiddenException();
    } else if (provider === 'n99') {
      const secret = process.env.N99_WEBHOOK_TOKEN;
      const sig = headers['x-signature'];
      const okToken = !!secret && !!token && safeEqual(token, secret);
      const okSig = !!secret && !!sig && safeEqual(createHmac('sha256', secret).update(raw).digest('hex'), sig);
      if (!okToken && !okSig) throw new ForbiddenException();
    } else {
      throw new NotFoundException();
    }

    const key = `webhook:${provider}:${createHash('sha256').update(raw).digest('hex')}`;
    await this.prisma.inboundEvent
      .create({ data: { provider: `webhook:${provider}`, idempotencyKey: key, payload: JSON.parse(raw.toString('utf8') || '{}') } })
      .catch((e: { code?: string }) => {
        if (e.code !== 'P2002') throw e; // P2002 = aviso repetido, já gravado
      });
    return { ok: true };
  }
}
