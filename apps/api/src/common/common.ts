import {
  ArgumentsHost,
  CallHandler,
  Catch,
  ExceptionFilter,
  ExecutionContext,
  HttpException,
  Injectable,
  Logger,
  NestInterceptor,
  SetMetadata,
  CanActivate,
  createParamDecorator,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import { Observable, tap } from 'rxjs';
import { randomUUID } from 'node:crypto';
import {
  AppError,
  errors,
  redact,
  UserRole,
  type Principal,
  can as principalCan,
  type Permission,
} from '@autoparts/core';

/* ─────────────────────── request id ─────────────────────── */

// Request.principal / Request.requestId: see src/types/express.d.ts

@Injectable()
export class RequestIdInterceptor implements NestInterceptor {
  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = ctx.switchToHttp().getRequest<Request>();
    const res = ctx.switchToHttp().getResponse<Response>();
    const id = (req.headers['x-request-id'] as string | undefined) ?? randomUUID();
    req.requestId = id;
    res.setHeader('x-request-id', id);
    return next.handle();
  }
}

/* ─────────────────────── logging ─────────────────────── */

/**
 * Structured access log. Every payload goes through `redact` so a VIN, phone
 * number or token can never reach a log line (docs/07 §7).
 */
@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = ctx.switchToHttp().getRequest<Request>();
    const started = Date.now();

    return next.handle().pipe(
      tap({
        next: () => this.write(req, ctx, started, 'ok'),
        error: () => this.write(req, ctx, started, 'error'),
      }),
    );
  }

  private write(req: Request, ctx: ExecutionContext, started: number, outcome: string): void {
    const res = ctx.switchToHttp().getResponse<Response>();
    this.logger.log(
      JSON.stringify(
        redact({
          requestId: req.requestId,
          method: req.method,
          path: req.originalUrl,
          status: res.statusCode,
          durationMs: Date.now() - started,
          outcome,
          userId: req.principal?.userId ?? null,
        }),
      ),
    );
  }
}

/* ─────────────────────── error filter ─────────────────────── */

/**
 * Turns every thrown value into the single error shape from docs/04 §1.2.
 * Unknown errors are never echoed back to the client — they are logged and
 * reported as a generic internal error, so stack traces and provider
 * responses cannot leak.
 */
@Catch()
export class AppExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('Exception');

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();
    const requestId = req.requestId;

    if (exception instanceof AppError) {
      res.status(exception.status).json(exception.toBody(requestId));
      return;
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const response = exception.getResponse();
      const message =
        typeof response === 'string'
          ? response
          : ((response as { message?: string | string[] }).message ?? exception.message);

      res.status(status).json({
        error: {
          code: status === 404 ? 'NOT_FOUND' : 'VALIDATION_FAILED',
          message: Array.isArray(message) ? message.join('; ') : message,
          messageKey: status === 404 ? 'error.notFound' : 'error.validation',
          ...(requestId ? { requestId } : {}),
        },
      });
      return;
    }

    this.logger.error(
      JSON.stringify(redact({ requestId, error: exception })),
      exception instanceof Error ? exception.stack : undefined,
    );
    res.status(500).json(errors.internal().toBody(requestId));
  }
}

/* ─────────────────────── auth decorators & guards ─────────────────────── */

export const IS_PUBLIC = 'isPublic';
export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(IS_PUBLIC, true);

export const REQUIRED_ROLES = 'requiredRoles';
export const Roles = (...roles: UserRole[]): MethodDecorator & ClassDecorator =>
  SetMetadata(REQUIRED_ROLES, roles);

export const REQUIRED_PERMISSIONS = 'requiredPermissions';
export const RequirePermissions = (...perms: Permission[]): MethodDecorator & ClassDecorator =>
  SetMetadata(REQUIRED_PERMISSIONS, perms);

export const CurrentPrincipal = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): Principal => {
    const req = ctx.switchToHttp().getRequest<Request>();
    if (!req.principal) throw errors.unauthenticated();
    return req.principal;
  },
);

/**
 * Role and permission enforcement.
 *
 * Note what this guard deliberately does NOT do: partner scoping. Checking
 * "is this row mine?" in a guard is easy to forget on the next endpoint, so
 * it lives in the repository layer instead (docs/07 §5.1), where it cannot
 * be skipped.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (isPublic) return true;

    const req = ctx.switchToHttp().getRequest<Request>();
    const principal = req.principal;
    if (!principal) throw errors.unauthenticated();

    const roles = this.reflector.getAllAndOverride<UserRole[]>(REQUIRED_ROLES, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (roles?.length && !roles.some((r) => principal.roles.includes(r))) {
      throw errors.notFound();
    }

    const perms = this.reflector.getAllAndOverride<Permission[]>(REQUIRED_PERMISSIONS, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (perms?.length && !perms.every((p) => principalCan(principal, p))) {
      throw errors.notFound();
    }

    return true;
  }
}
