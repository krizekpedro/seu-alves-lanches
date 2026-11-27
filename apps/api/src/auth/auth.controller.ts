import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { emailLoginInput, pinLoginInput } from '@seu-alves/shared';
import { ZodPipe } from '../common/zod.pipe';
import { AuthService } from './auth.service';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('login')
  login(@Body(new ZodPipe(emailLoginInput)) body: { email: string; password: string }) {
    return this.auth.loginWithEmail(body.email, body.password);
  }

  @Post('pin')
  pin(@Body(new ZodPipe(pinLoginInput)) body: { userId: string; storeId: string; pin: string }) {
    return this.auth.loginWithPin(body.userId, body.storeId, body.pin);
  }

  @Get('stores/:storeId/staff')
  staff(@Param('storeId', ParseUUIDPipe) storeId: string) {
    return this.auth.staffForPinScreen(storeId);
  }
}
