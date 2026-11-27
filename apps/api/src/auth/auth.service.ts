import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import bcrypt from 'bcryptjs';
import { PrismaService } from '../common/prisma.service';
import type { AuthUser } from './auth.guard';

@Injectable()
export class AuthService {
  constructor(private readonly prisma: PrismaService, private readonly jwt: JwtService) {}

  /** Dono e gerentes: e-mail e senha, de qualquer lugar. */
  async loginWithEmail(email: string, password: string) {
    const user = await this.prisma.user.findUnique({ where: { email }, include: { stores: true } });
    const ok = user?.active && user.passwordHash && (await bcrypt.compare(password, user.passwordHash));
    const membership = user?.stores.find((s) => s.role === 'DONO' || s.role === 'GERENTE');
    if (!ok || !user || !membership) throw new UnauthorizedException('E-mail ou senha incorretos');
    return this.issue({ sub: user.id, storeId: membership.storeId, role: membership.role, name: user.name });
  }

  /** Equipe da loja: PIN de 4 números, num aparelho da loja. */
  async loginWithPin(userId: string, storeId: string, pin: string) {
    const membership = await this.prisma.storeUser.findUnique({
      where: { userId_storeId: { userId, storeId } },
      include: { user: true },
    });
    const ok = membership?.user.active && membership.user.pinHash && (await bcrypt.compare(pin, membership.user.pinHash));
    if (!ok || !membership) throw new UnauthorizedException('PIN incorreto');
    await this.prisma.userSession.create({ data: { userId } });
    return this.issue({ sub: userId, storeId, role: membership.role, name: membership.user.name });
  }

  /** Nomes e funções para a tela "Quem está entrando?" (sem dados sensíveis). */
  async staffForPinScreen(storeId: string) {
    const rows = await this.prisma.storeUser.findMany({
      where: { storeId, user: { active: true, pinHash: { not: null } }, role: { not: 'MOTOBOY' } },
      include: { user: { select: { id: true, name: true } } },
      orderBy: { user: { name: 'asc' } },
    });
    return rows.map((r) => ({ id: r.user.id, name: r.user.name, role: r.role }));
  }

  private async issue(payload: AuthUser) {
    return { token: await this.jwt.signAsync(payload), user: payload };
  }
}
