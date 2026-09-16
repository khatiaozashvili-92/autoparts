import { Global, Injectable, Module, type NestMiddleware } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import type { NextFunction, Request, Response } from 'express';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { OtpService } from './otp.service.js';
import { smsProvider, SMS_PROVIDER } from './sms.provider.js';
import { TokenService } from './token.service.js';
import type { AppConfig } from '../../config/configuration.js';

/**
 * Populates `req.principal` from the bearer token when one is present.
 *
 * It never rejects: an absent or bad token simply leaves the request
 * unauthenticated, and `RolesGuard` decides whether that is acceptable for the
 * route. Keeping the two apart is what lets public and private routes share
 * one pipeline.
 */
@Injectable()
export class PrincipalMiddleware implements NestMiddleware {
  constructor(private readonly tokens: TokenService) {}

  async use(req: Request, _res: Response, next: NextFunction): Promise<void> {
    const header = req.headers.authorization;
    if (header?.startsWith('Bearer ')) {
      try {
        req.principal = await this.tokens.verifyAccess(header.slice(7));
      } catch {
        // Left unauthenticated on purpose — see the note above.
      }
    }
    next();
  }
}

@Global()
@Module({
  imports: [
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<AppConfig, true>) => ({
        secret: config.get('JWT_SECRET', { infer: true }),
        signOptions: { expiresIn: config.get('JWT_ACCESS_TTL', { infer: true }) },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, OtpService, TokenService, PrincipalMiddleware, smsProvider],
  exports: [AuthService, TokenService, OtpService, SMS_PROVIDER],
})
export class AuthModule {}
