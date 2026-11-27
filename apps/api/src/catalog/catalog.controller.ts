import { Body, Controller, ForbiddenException, Get, NotFoundException, Param, ParseUUIDPipe, Patch, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { PrismaService } from '../common/prisma.service';
import { ZodPipe } from '../common/zod.pipe';
import { AuthGuard, AuthUser, CurrentUser, Roles } from '../auth/auth.guard';

const availabilityInput = z.object({ available: z.boolean() });

@Controller()
export class CatalogController {
  constructor(private readonly prisma: PrismaService) {}

  /** Cardápio público da loja (usado pelo cardápio digital e pelo PDV). */
  @Get('stores/:storeId/menu')
  async menu(@Param('storeId', ParseUUIDPipe) storeId: string) {
    const categories = await this.prisma.category.findMany({
      where: { storeId, active: true },
      orderBy: { position: 'asc' },
      include: {
        products: {
          where: { active: true },
          orderBy: { name: 'asc' },
          include: { optionGroups: { include: { group: { include: { options: { where: { active: true } } } } } } },
        },
      },
    });
    const zones = await this.prisma.deliveryZone.findMany({ where: { storeId }, orderBy: { name: 'asc' } });
    return { categories, deliveryZones: zones };
  }

  /** Esgotar ou reativar um produto em todos os canais. */
  @Patch('products/:id/availability')
  @UseGuards(AuthGuard)
  @Roles('DONO', 'GERENTE', 'CAIXA')
  async setAvailability(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(availabilityInput)) body: { available: boolean },
    @CurrentUser() user: AuthUser,
  ) {
    const product = await this.prisma.product.findUnique({ where: { id } });
    if (!product) throw new NotFoundException('Produto não encontrado');
    if (product.storeId !== user.storeId) throw new ForbiddenException();
    const [updated] = await this.prisma.$transaction([
      this.prisma.product.update({ where: { id }, data: { available: body.available } }),
      this.prisma.outboxEvent.create({
        data: { type: 'availability.changed', aggregateId: id, payload: { productId: id, available: body.available } },
      }),
      this.prisma.auditLog.create({
        data: { storeId: user.storeId, userId: user.sub, action: body.available ? 'produto.ativar' : 'produto.esgotar', entity: 'product', entityId: id },
      }),
    ]);
    return updated;
  }
}
