import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PrismaService } from './common/prisma.service';
import { HealthController } from './common/health.controller';
import { AuthController } from './auth/auth.controller';
import { AuthService } from './auth/auth.service';
import { CatalogController } from './catalog/catalog.controller';
import { OrdersController } from './orders/orders.controller';
import { OrdersService } from './orders/orders.service';
import { MetricsController } from './metrics/metrics.controller';
import { MetricsService } from './metrics/metrics.service';

const jwtSecret = process.env.JWT_SECRET;
if (!jwtSecret && process.env.NODE_ENV === 'production') {
  throw new Error('JWT_SECRET é obrigatório em produção');
}

@Module({
  imports: [JwtModule.register({ global: true, secret: jwtSecret ?? 'dev-only-secret', signOptions: { expiresIn: '12h' } })],
  controllers: [HealthController, AuthController, CatalogController, OrdersController, MetricsController],
  providers: [PrismaService, AuthService, OrdersService, MetricsService],
})
export class AppModule {}
