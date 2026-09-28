import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Post,
  Req,
} from '@nestjs/common';
import { AuthUser } from '@arkan/shared';
import { AuthService } from './auth.service';
import { Public } from './decorators/public.decorator';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}
  @Public()
  @Post('login')
  @Header('Cache-Control', 'no-store')
  @HttpCode(200)
  login(@Body() body: LoginDto) {
    return this.auth.login(body);
  }
  @Public()
  @Post('refresh')
  @Header('Cache-Control', 'no-store')
  @HttpCode(200)
  refresh(@Body() body: RefreshTokenDto) {
    return this.auth.refresh(body);
  }
  @Public()
  @Post('logout')
  @HttpCode(200)
  logout(@Body() body: RefreshTokenDto) {
    return this.auth.logout(body);
  }
  @Get('me')
  me(@Req() request: { user: AuthUser }) {
    return request.user;
  }
}
