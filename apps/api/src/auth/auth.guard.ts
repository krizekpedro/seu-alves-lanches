import { CanActivate, ExecutionContext, ForbiddenException, Injectable, SetMetadata, UnauthorizedException, createParamDecorator } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { Role } from '@seu-alves/db';

export interface AuthUser {
  sub: string;
  storeId: string;
  role: Role;
  name: string;
}

export const ROLES_KEY = 'roles';
/** Restringe a rota a estes papéis. Sem @Roles, qualquer funcionário logado acessa. */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthUser => {
  return ctx.switchToHttp().getRequest().user;
});

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly jwt: JwtService, private readonly reflector: Reflector) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const header: string | undefined = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) throw new UnauthorizedException('Faça login');
    try {
      req.user = await this.jwt.verifyAsync<AuthUser>(header.slice(7));
    } catch {
      throw new UnauthorizedException('Sessão expirada');
    }
    const roles = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES_KEY, [ctx.getHandler(), ctx.getClass()]);
    if (roles && !roles.includes(req.user.role)) throw new ForbiddenException('Sua função não tem acesso a esta ação');
    return true;
  }
}
