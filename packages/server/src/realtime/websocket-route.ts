/**
 * Mounts Hocuspocus on Fastify's WebSocket route.
 *
 * Owns: the bridge between `@fastify/websocket` (a `ws` socket + Node request) and
 * Hocuspocus v4's transport-agnostic `handleConnection`, which expects a WHATWG `Request`
 * and external message/close dispatch.
 */

import { type IncomingMessage } from 'node:http';

import websocket from '@fastify/websocket';
import { type Hocuspocus } from '@hocuspocus/server';
import { type FastifyInstance } from 'fastify';
import type { WebSocket } from 'ws';

/** Path of the realtime endpoint. */
export const REALTIME_PATH = '/realtime';

/**
 * Converts a `ws` message payload into the `Uint8Array` Hocuspocus expects.
 *
 * @param {Buffer | ArrayBuffer | Buffer[]} data - Raw payload from `ws`.
 * @returns {Uint8Array} The bytes.
 */
export function toUint8Array(data: Buffer | ArrayBuffer | Buffer[]): Uint8Array {
  if (Array.isArray(data)) return new Uint8Array(Buffer.concat(data));
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
}

/**
 * Builds a WHATWG `Request` from a Node upgrade request so Hocuspocus can read headers and
 * query parameters.
 *
 * @param {IncomingMessage} raw - Node request of the upgrade.
 * @returns {Request} Equivalent fetch-style request (GET, no body).
 */
export function toFetchRequest(raw: IncomingMessage): Request {
  const host = raw.headers.host ?? 'localhost';
  const headers = new Headers();
  for (const [key, value] of Object.entries(raw.headers)) {
    if (typeof value === 'string') headers.set(key, value);
    else if (Array.isArray(value)) headers.set(key, value.join(', '));
  }
  return new Request(`http://${host}${raw.url ?? '/'}`, { method: 'GET', headers });
}

/**
 * Registers `GET /realtime` as the Hocuspocus WebSocket endpoint.
 *
 * @param {FastifyInstance} app - Fastify instance.
 * @param {Hocuspocus} hocuspocus - Configured realtime server.
 * @param {number} maxPayloadBytes - Largest WebSocket frame accepted.
 * @returns {Promise<void>} Resolves when the route is registered.
 */
export async function registerRealtimeRoute(
  app: FastifyInstance,
  hocuspocus: Hocuspocus,
  maxPayloadBytes: number,
): Promise<void> {
  await app.register(websocket, { options: { maxPayload: maxPayloadBytes } });
  app.get(
    REALTIME_PATH,
    { websocket: true, config: { rateLimit: false } },
    (socket: WebSocket, request) => {
      const connection = hocuspocus.handleConnection(socket, toFetchRequest(request.raw), {});
      socket.on('message', (data: Buffer | ArrayBuffer | Buffer[]) => {
        connection.handleMessage(toUint8Array(data));
      });
      socket.on('close', () => {
        connection.handleClose();
      });
      socket.on('error', (error: Error) => {
        request.log.warn({ err: error }, 'realtime socket error');
      });
    },
  );
}
