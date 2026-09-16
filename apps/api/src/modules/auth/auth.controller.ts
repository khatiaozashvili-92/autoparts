import { Body, Controller, Get, HttpCode, Ip, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { IsOptional, IsString, IsUUID, Length, Matches, MaxLength } from 'class-validator';
import { CurrentPrincipal, Public } from '../../common/common.js';
import { AuthService } from './auth.service.js';
import { TokenService } from './token.service.js';
import type { Principal } from '@autoparts/core';

class RequestCodeDto {
  /** Normalised server-side; the client may send any readable spelling. */
  @IsString() @MaxLength(20) phone!: string;
}

class VerifyCodeDto {
  @IsUUID() challengeId!: string;
  @IsString() @Matches(/^\d{6}$/, { message: 'code must be six digits' }) code!: string;
  @IsOptional() @IsString() @Length(1, 80) firstName?: string;
  @IsOptional() @IsString() @Length(1, 80) lastName?: string;
  @IsOptional() @IsString() locale?: string;
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

  /**
   * Tighter than the global limit (docs/04 §10), but deliberately not tight.
   *
   * The real defence against code-pumping is per-number and lives in
   * `OtpService`: one code a minute, five an hour, for that number. This limit
   * only catches something hammering the endpoint from one address, so it has
   * to stay loose enough for the address a whole office — or a mobile carrier's
   * NAT, which is most of the Georgian market — signs in from.
   */
  @Public()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post('otp/request')
  @HttpCode(200)
  @ApiOperation({ summary: 'Send a one-time code to a phone number' })
  requestCode(@Body() dto: RequestCodeDto, @Ip() ip: string) {
    return this.auth.requestCode({ phone: dto.phone, requestIp: ip });
  }

  @Public()
  @Throttle({ default: { limit: 15, ttl: 60_000 } })
  @Post('otp/verify')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Exchange a one-time code for a token pair, creating the account if it is new',
  })
  verifyCode(@Body() dto: VerifyCodeDto) {
    return this.auth.verifyCode(dto);
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
