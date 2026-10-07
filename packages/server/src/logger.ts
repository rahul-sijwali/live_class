/**
 * Structured logging with pino.
 *
 * Owns: logger construction and the redaction list. Levels (CLAUDE.md §11): `error` needs
 * a human, `warn` is degraded, `info` is lifecycle, `debug` is development.
 */

import pino, { type Logger } from 'pino';

import { type Config } from './config.js';

/**
 * Creates the root logger for the server.
 *
 * @param {Pick<Config, 'LOG_LEVEL' | 'LOG_PRETTY'>} config - Level and pretty-print flag.
 * @returns {Logger} A pino logger that never prints bearer tokens or passwords.
 */
export function createLogger(config: Pick<Config, 'LOG_LEVEL' | 'LOG_PRETTY'>): Logger {
  return pino({
    level: config.LOG_LEVEL,
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        'password',
        'token',
        '*.password',
        '*.token',
      ],
      censor: '[redacted]',
    },
    ...(config.LOG_PRETTY
      ? {
          transport: {
            target: 'pino-pretty',
            options: { colorize: true, translateTime: 'HH:MM:ss' },
          },
        }
      : {}),
  });
}
