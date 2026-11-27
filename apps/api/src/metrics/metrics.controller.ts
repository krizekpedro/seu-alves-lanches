import { Controller, ForbiddenException, Get, Param, ParseUUIDPipe, Query, UseGuards } from '@nestjs/common';
import { AuthGuard, AuthUser, CurrentUser, Roles } from '../auth/auth.guard';
import { MetricsService } from './metrics.service';

@Controller('stores/:storeId/metrics')
@UseGuards(AuthGuard)
@Roles('DONO', 'GERENTE')
export class MetricsController {
  constructor(private readonly metrics: MetricsService) {}

  @Get('stages')
  stages(
    @Param('storeId', ParseUUIDPipe) storeId: string,
    @Query('day') day: string | undefined,
    @Query('flow') flow: string | undefined,
    @CurrentUser() user: AuthUser,
  ) {
    if (storeId !== user.storeId) throw new ForbiddenException();
    return this.metrics.stages(storeId, day ? new Date(`${day}T12:00:00`) : new Date(), flow === 'balcao' ? 'balcao' : 'delivery');
  }
}
