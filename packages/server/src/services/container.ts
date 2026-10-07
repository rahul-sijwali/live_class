/**
 * The set of collaborators route modules receive.
 *
 * Owns: only the type. Construction happens in `app.ts` so tests can substitute pieces.
 */

import { type Hocuspocus } from '@hocuspocus/server';
import { type Logger } from 'pino';

import { type TokenService } from '../auth/tokens.js';
import { SessionPolicy } from '../authz/policies.js';
import { type Config } from '../config.js';
import { type DatabaseHandle } from '../db/client.js';
import { type Metrics } from '../metrics.js';
import { type StorageAdapter } from '../storage/storage-adapter.js';
import { type AssetService } from './asset-service.js';
import { type QuestionService } from './question-service.js';
import { type SessionService } from './session-service.js';
import { type UserService } from './user-service.js';

/** Everything a route handler may need. */
export interface Services {
  readonly config: Config;
  readonly logger: Logger;
  readonly database: DatabaseHandle;
  readonly storage: StorageAdapter;
  readonly tokens: TokenService;
  readonly users: UserService;
  readonly assets: AssetService;
  readonly questions: QuestionService;
  readonly sessions: SessionService;
  readonly sessionPolicy: SessionPolicy;
  readonly realtime: Hocuspocus;
  readonly metrics: Metrics;
}

export { SessionPolicy };
