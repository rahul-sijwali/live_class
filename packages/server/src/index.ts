/**
 * Process entry point: load config, build, listen, shut down cleanly on signals.
 */

import { buildServer } from './app.js';
import { loadConfig } from './config.js';

const config = loadConfig(process.env);
const { app } = await buildServer(config);

await app.listen({ port: config.PORT, host: config.HOST });
app.log.info({ port: config.PORT, realtime: '/realtime' }, 'live class server listening');

let shuttingDown = false;
/**
 * Stops accepting work, flushes realtime documents and closes connections.
 *
 * @param {string} signal - The signal that triggered the shutdown.
 * @returns {Promise<void>} Resolves when the process may exit.
 */
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  app.log.info({ signal }, 'shutting down');
  const timer = setTimeout(() => {
    app.log.error('shutdown timed out; exiting');
    process.exit(1);
  }, 15_000);
  try {
    await app.close();
    clearTimeout(timer);
    process.exit(0);
  } catch (error) {
    app.log.error({ err: error }, 'shutdown failed');
    process.exit(1);
  }
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
