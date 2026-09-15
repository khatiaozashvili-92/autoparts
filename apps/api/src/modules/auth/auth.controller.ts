import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { IsEmail, IsOptional, IsString, MinLength } from 'class-validator';
import { CurrentPrincipal, Public } from '../../common/common.js';
import { AuthService } from './auth.service.js';
import { TokenService } from './token.service.js';
import { MIN_PASSWORD_LENGTH } from './password.service.js';
import type { Principal } from '@autoparts/core';

class RegisterDto {
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @IsString() phone?: string;
  @IsString() @MinLength(MIN_PASSWORD_LENGTH) password!: string;
  @IsOptional() @IsString() firstName?: string;
  @IsOptional() @IsString() lastName?: string;
  @IsOptional() @IsString() locale?: string;
}

class LoginDto {
  @IsString() identifier!: string;
  @IsString() password!: string;
  @IsOptional() @IsString() deviceId?: string;
}

class RefreshDto {
  @IsString() refreshToken!: string;
  @IsOptional() @IsString() deviceId?: string;
}

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly tokens: TokenService,
  ) {}

  // Tighter than the global limit: these are the endpoints worth guessing at
  // (docs/04 §10).
  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('register')
  @ApiOperation({ summary: 'Create an account with an e-mail or phone number' })
  register(@Body() dto: RegisterDto) {
    return this.auth.register(dto);
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('login')
  @HttpCode(200)
  @ApiOperation({ summary: 'Exchange credentials for a token pair' })
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto);
  }

  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post('refresh')
  @HttpCode(200)
  @ApiOperation({ summary: 'Rotate a refresh token' })
  refresh(@Body() dto: RefreshDto) {
    return this.tokens.rotate(dto.refreshToken, dto.deviceId);
  }

  @Public()
  @Post('logout')
  @HttpCode(204)
  @ApiOperation({ summary: 'Revoke a refresh token' })
  async logout(@Body() dto: RefreshDto): Promise<void> {
    await this.tokens.revoke(dto.refreshToken);
  }

  @Get('me')
  @ApiOperation({ summary: 'The authenticated user and their roles' })
  me(@CurrentPrincipal() principal: Principal) {
    return this.auth.me(principal);
  }
}
