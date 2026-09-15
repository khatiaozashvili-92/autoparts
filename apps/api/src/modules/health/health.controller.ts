import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { Public } from '../../common/common.js';
import { DatabaseService } from '../../database/database.module.js';
import type { AppConfig } from '../../config/configuration.js';

type DependencyState = 'ok' | 'not_configured' | 'unreachable';

interface DependencyReport {
  name: string;
  state: DependencyState;
  /** Which build step turns this from not_configured into ok. */
  requiredFromStep: number;
  latencyMs?: number;
  detail?: string;
}

@ApiTags('health')
@Controller()
export class HealthController {
  constructor(
    private readonly config: ConfigService<AppConfig, true>,
    private readonly db: DatabaseService,
  ) {}

  @Public()
  @Get('health')
  @ApiOperation({ summary: 'Liveness probe' })
  health() {
    return { status: 'ok', uptimeSeconds: Math.round(process.uptime()) };
  }

  /**
   * Readiness with a per-dependency breakdown.
   *
   * `not_configured` and `unreachable` are deliberately distinct: a dependency
   * that has not been wired up yet is a known state of the build, while one
   * that is configured and failing is an outage. Collapsing the two would hide
   * a real incident behind an expected one.
   */
  @Public()
  @Get('ready')
  @ApiOperation({ summary: 'Readiness with dependency breakdown' })
  async ready() {
    const dependencies: DependencyReport[] = [
      await this.checkPostgres(),
      this.checkUrlOnly('redis', this.config.get('REDIS_URL', { infer: true }), 9),
      this.checkUrlOnly('opensearch', this.config.get('OPENSEARCH_URL', { infer: true }), 7),
    ];

    const blocking = dependencies.filter((d) => d.state === 'unreachable');

    return {
      status: blocking.length === 0 ? 'ok' : 'degraded',
      currentStep: 5,
      migrationsApplied: await this.db.migrationCount(),
      dependencies,
    };
  }

  private async checkPostgres(): Promise<DependencyReport> {
    if (!this.db.configured) {
      return {
        name: 'postgres',
        state: 'not_configured',
        requiredFromStep: 2,
        detail: 'DATABASE_URL is empty',
      };
    }
    const ping = await this.db.ping();
    return ping.ok
      ? { name: 'postgres', state: 'ok', requiredFromStep: 2, latencyMs: ping.latencyMs }
      : {
          name: 'postgres',
          state: 'unreachable',
          requiredFromStep: 2,
          latencyMs: ping.latencyMs,
          ...(ping.error ? { detail: ping.error } : {}),
        };
  }

  private checkUrlOnly(name: string, url: string, requiredFromStep: number): DependencyReport {
    if (!url) {
      return {
        name,
        state: 'not_configured',
        requiredFromStep,
        detail: `Configured from build step ${requiredFromStep}`,
      };
    }
    // Replaced by a real probe at the step that introduces this dependency.
    return { name, state: 'ok', requiredFromStep };
  }
}
