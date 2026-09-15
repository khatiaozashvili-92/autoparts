import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createVinCipher, type VinCipher } from '@autoparts/db';
import type { AppConfig } from '../../config/configuration.js';

/**
 * Thin DI wrapper over the shared cipher in `@autoparts/db`.
 *
 * The implementation deliberately lives in core so the seed and any import job
 * write rows this service can read back — a second implementation is exactly
 * how unreadable rows get created.
 */
@Injectable()
export class VinCryptoService {
  private readonly cipher: VinCipher;

  constructor(config: ConfigService<AppConfig, true>) {
    this.cipher = createVinCipher(config.get('VIN_ENCRYPTION_KEY', { infer: true }));
  }

  hash(vin: string): Buffer {
    return this.cipher.hash(vin);
  }

  encrypt(vin: string): Buffer {
    return this.cipher.encrypt(vin);
  }

  /** Null when the stored payload cannot be decrypted (see core for why). */
  decrypt(payload: Buffer): string | null {
    return this.cipher.decrypt(payload);
  }
}
