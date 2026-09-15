import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { Public } from '../../common/common.js';
import type { AppConfig } from '../../config/configuration.js';

type DependencyState = 'ok' | 'not_configured' | 'unreachable';

interface DependencyReport {
  name: string;
  state: DependencyState;
  /** Which build step turns this from not_configured into ok. */
  requiredFromStep: number;
  detail?: string;
}

@ApiTags('health')
@Controller()
export class HealthController {
  constructor(private readonly config: ConfigService<AppConfig, true>) {}

  @Public()
  @Get('health')
  @ApiOperation({ summary: 'Liveness probe' })
  health() {
    return { status: 'ok', uptimeSeconds: Math.round(process.uptime()) };
  }

  /**
   * Readiness with a per-dependency breakdown.
   *
   * During Step 1 the datastores are intentionally absent, so a missing
   * DATABASE_URL reports `not_configured` rather than `unreachable` — an
   * unconfigured dependency is a known state, not a failure, and conflating
   * the two makes a real outage harder to spot later.
   */
  @Public()
  @Get('ready')
  @ApiOperation({ summary: 'Readiness with dependency breakdown' })
  ready() {
    const dependencies: DependencyReport[] = [
      this.check('postgres', this.config.get('DATABASE_URL', { infer: true }), 2),
      this.check('redis', this.config.get('REDIS_URL', { infer: true }), 9),
      this.check('opensearch', this.config.get('OPENSEARCH_URL', { infer: true }), 7),
    ];

    const blocking = dependencies.filter((d) => d.state === 'unreachable');

    return {
      status: blocking.length === 0 ? 'ok' : 'degraded',
      currentStep: 1,
      dependencies,
    };
  }

  private check(name: string, url: string, requiredFromStep: number): DependencyReport {
    if (!url) {
      return {
        name,
        state: 'not_configured',
        requiredFromStep,
        detail: `Configured from build step ${requiredFromStep}`,
      };
    }
    // Step 2+ replaces this with a real connection probe.
    return { name, state: 'ok', requiredFromStep };
  }
}
