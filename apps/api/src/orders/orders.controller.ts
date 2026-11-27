import { Body, Controller, ForbiddenException, Get, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { ChangeStatusInput, CreateOrderInput, ORDER_STATUSES, OrderStatus, changeStatusInput, createOrderInput } from '@seu-alves/shared';
import { ZodPipe } from '../common/zod.pipe';
import { AuthGuard, AuthUser, CurrentUser } from '../auth/auth.guard';
import { OrdersService } from './orders.service';

const SOURCE_BY_ROLE: Record<string, string> = { COZINHA: 'cozinha', CAIXA: 'balcao', MOTOBOY: 'motoboy' };

@Controller()
@UseGuards(AuthGuard)
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Post('orders')
  create(@Body(new ZodPipe(createOrderInput)) body: CreateOrderInput, @CurrentUser() user: AuthUser) {
    if (body.storeId !== user.storeId) throw new ForbiddenException();
    return this.orders.create(body, SOURCE_BY_ROLE[user.role] ?? 'sistema', user.sub);
  }

  @Get('stores/:storeId/orders')
  list(@Param('storeId', ParseUUIDPipe) storeId: string, @Query('status') status: string | undefined, @CurrentUser() user: AuthUser) {
    if (storeId !== user.storeId) throw new ForbiddenException();
    const statuses = status?.split(',').filter((s): s is OrderStatus => (ORDER_STATUSES as readonly string[]).includes(s));
    return this.orders.list(storeId, statuses);
  }

  @Post('orders/:id/status')
  changeStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(changeStatusInput)) body: ChangeStatusInput,
    @CurrentUser() user: AuthUser,
  ) {
    return this.orders.changeStatus(id, user.storeId, body.to, SOURCE_BY_ROLE[user.role] ?? 'sistema', user.sub, body.reason);
  }
}
