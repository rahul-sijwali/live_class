import { describe, expect, it } from 'vitest';

import { loadConfig, testConfig } from './config.js';

describe('loadConfig', () => {
  it('applies defaults and parses lists and booleans', () => {
    const config = loadConfig({
      DATABASE_URL: 'pglite://memory',
      CORS_ORIGINS: 'https://a.example, https://b.example',
      AUTH_HOST_SHARED_SECRET: 'x'.repeat(40),
      TRUST_PROXY: 'false',
    });
    expect(config.PORT).toBe(4000);
    expect(config.CORS_ORIGINS).toEqual(['https://a.example', 'https://b.example']);
    expect(config.TRUST_PROXY).toBe(false);
    expect(config.STORAGE_DRIVER).toBe('local');
    expect(config.AUTH_LOCAL_ENABLED).toBe(false);
  });

  it('requires some way to authenticate', () => {
    expect(() => loadConfig({ DATABASE_URL: 'pglite://memory' })).toThrow(
      /AUTH_HOST_SHARED_SECRET/,
    );
  });

  it('requires S3 settings when the S3 driver is chosen', () => {
    expect(() =>
      loadConfig({
        DATABASE_URL: 'pglite://memory',
        AUTH_HOST_SHARED_SECRET: 'x'.repeat(40),
        STORAGE_DRIVER: 's3',
      }),
    ).toThrow(/S3_BUCKET/);
  });

  it('requires a long local secret when local login is on', () => {
    expect(() =>
      loadConfig({
        DATABASE_URL: 'pglite://memory',
        AUTH_LOCAL_ENABLED: 'true',
        AUTH_LOCAL_JWT_SECRET: 'short',
      }),
    ).toThrow(/AUTH_LOCAL_JWT_SECRET/);
  });

  it('refuses local login in production', () => {
    expect(() =>
      loadConfig({
        NODE_ENV: 'production',
        DATABASE_URL: 'postgres://u:p@h/db',
        AUTH_LOCAL_ENABLED: 'true',
        AUTH_LOCAL_JWT_SECRET: 'x'.repeat(40),
      }),
    ).toThrow(/production/);
  });

  it('lists every problem at once', () => {
    expect(() => loadConfig({ PORT: 'abc' })).toThrow(
      /DATABASE_URL[\s\S]*PORT|PORT[\s\S]*DATABASE_URL/,
    );
  });

  it('provides a valid test configuration', () => {
    const config = testConfig();
    expect(config.AUTH_LOCAL_ENABLED).toBe(true);
    expect(config.DATABASE_URL).toBe('pglite://memory');
  });
});
