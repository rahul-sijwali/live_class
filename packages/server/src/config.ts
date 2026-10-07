/**
 * Server configuration, validated once at start-up.
 *
 * Owns: the schema of every environment variable and the typed `Config` the rest of the
 * server reads. Nothing else reads `process.env`. A bad or missing value stops the process
 * with a readable message (CLAUDE.md §4: fail loudly at start-up).
 */

import { z } from 'zod';

import { MAX_UPLOAD_MB } from '@live-class/shared';

/** Parses `true/false/1/0/yes/no` strings. */
const booleanString = z
  .union([z.boolean(), z.string()])
  .transform((value) => (typeof value === 'boolean' ? value : /^(true|1|yes)$/i.test(value)));

/** Comma-separated list → trimmed, non-empty strings. */
const commaList = z.string().transform((value) =>
  value
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0),
);

const EnvSchema = z
  .object({
    /** `demo` behaves like production (JSON logs) but allows the seeded local login. */
    NODE_ENV: z.enum(['development', 'test', 'demo', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(4000),
    HOST: z.string().default('0.0.0.0'),
    /** Trust `X-Forwarded-*` headers (true behind any PaaS load balancer). */
    TRUST_PROXY: booleanString.default(true),
    CORS_ORIGINS: commaList.default(['http://localhost:3000']),

    DATABASE_URL: z.string().min(1, 'DATABASE_URL is required (postgres://… or pglite://…)'),
    DB_MIGRATE_ON_START: booleanString.default(true),

    STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
    STORAGE_LOCAL_DIR: z.string().default('./.data/uploads'),
    S3_ENDPOINT: z.url().optional(),
    S3_REGION: z.string().default('us-east-1'),
    S3_BUCKET: z.string().optional(),
    S3_ACCESS_KEY_ID: z.string().optional(),
    S3_SECRET_ACCESS_KEY: z.string().optional(),
    S3_FORCE_PATH_STYLE: booleanString.default(true),

    AUTH_HOST_JWKS_URL: z.url().optional(),
    AUTH_HOST_SHARED_SECRET: z.string().min(32).optional(),
    AUTH_HOST_ISSUER: z.string().default('live-class-host'),
    AUTH_HOST_AUDIENCE: z.string().default('live-class'),

    AUTH_LOCAL_ENABLED: booleanString.default(false),
    AUTH_LOCAL_JWT_SECRET: z.string().min(32).optional(),
    AUTH_LOCAL_SEED_PASSWORD: z.string().min(8).optional(),
    /** Lifetime of locally issued tokens, in seconds. */
    AUTH_LOCAL_TOKEN_TTL_SECONDS: z.coerce
      .number()
      .int()
      .min(60)
      .default(12 * 60 * 60),

    REDIS_URL: z.string().optional(),

    MAX_UPLOAD_MB: z.coerce.number().int().min(1).max(500).default(MAX_UPLOAD_MB),
    /** Login attempts per minute per client; raised only for automated tests. */
    RATE_LIMIT_LOGIN_PER_MINUTE: z.coerce.number().int().min(1).default(10),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    LOG_PRETTY: booleanString.default(false),
  })
  .superRefine((env, ctx) => {
    if (env.STORAGE_DRIVER === 's3') {
      for (const key of ['S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'] as const) {
        if (!env[key]) {
          ctx.addIssue({
            code: 'custom',
            path: [key],
            message: `${key} is required when STORAGE_DRIVER=s3`,
          });
        }
      }
    }
    const hasHostAuth = Boolean(env.AUTH_HOST_JWKS_URL) || Boolean(env.AUTH_HOST_SHARED_SECRET);
    if (!hasHostAuth && !env.AUTH_LOCAL_ENABLED) {
      ctx.addIssue({
        code: 'custom',
        path: ['AUTH_HOST_SHARED_SECRET'],
        message:
          'Provide AUTH_HOST_JWKS_URL or AUTH_HOST_SHARED_SECRET, or enable AUTH_LOCAL_ENABLED',
      });
    }
    if (env.AUTH_LOCAL_ENABLED && !env.AUTH_LOCAL_JWT_SECRET) {
      ctx.addIssue({
        code: 'custom',
        path: ['AUTH_LOCAL_JWT_SECRET'],
        message: 'AUTH_LOCAL_JWT_SECRET (≥ 32 chars) is required when AUTH_LOCAL_ENABLED=true',
      });
    }
    if (env.AUTH_LOCAL_ENABLED && env.NODE_ENV === 'production') {
      ctx.addIssue({
        code: 'custom',
        path: ['AUTH_LOCAL_ENABLED'],
        message: 'Local login must be disabled in production (CLAUDE.md §8)',
      });
    }
  });

/** Validated configuration. */
export type Config = z.infer<typeof EnvSchema>;

/**
 * Validates environment variables into a `Config`.
 *
 * @param {NodeJS.ProcessEnv | Record<string, string | undefined>} env - Usually `process.env`.
 * @returns {Config} The validated configuration with defaults applied.
 * @throws {Error} Listing every invalid or missing variable, one per line.
 */
export function loadConfig(env: Record<string, string | undefined>): Config {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((issue) => `  ${issue.path.join('.')}: ${issue.message}`);
    throw new Error(`Invalid server configuration:\n${lines.join('\n')}`);
  }
  return parsed.data;
}

/**
 * Builds a configuration for tests: embedded database, local storage in a temp dir,
 * local login enabled.
 *
 * @param {Partial<Record<string, string>>} overrides - Variables to override.
 * @returns {Config} A valid test configuration.
 */
export function testConfig(overrides: Partial<Record<string, string>> = {}): Config {
  return loadConfig({
    NODE_ENV: 'test',
    DATABASE_URL: 'pglite://memory',
    STORAGE_DRIVER: 'local',
    STORAGE_LOCAL_DIR: './.data/test-uploads',
    AUTH_LOCAL_ENABLED: 'true',
    AUTH_LOCAL_JWT_SECRET: 'test-secret-test-secret-test-secret-123456',
    AUTH_LOCAL_SEED_PASSWORD: 'password123',
    AUTH_HOST_SHARED_SECRET: 'host-secret-host-secret-host-secret-1234',
    LOG_LEVEL: 'silent',
    ...overrides,
  });
}
