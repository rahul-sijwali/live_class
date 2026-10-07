/**
 * Public configuration baked into the static build.
 */

/** Base URL of the Live Class server. */
export const API_BASE_URL = process.env['NEXT_PUBLIC_LIVE_CLASS_API'] ?? 'http://localhost:4000';

/** WebSocket URL of the realtime endpoint. */
export const REALTIME_URL =
  process.env['NEXT_PUBLIC_LIVE_CLASS_WS'] ?? 'ws://localhost:4000/realtime';
