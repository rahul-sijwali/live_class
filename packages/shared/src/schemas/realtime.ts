/**
 * Naming and shapes for the realtime (Yjs) layer.
 *
 * Owns: document names (`session:<id>`, `sheet:<id>`), the keys used inside each document
 * and the awareness (presence) state. Does not own Yjs itself; `@live-class/core` wraps the
 * documents and the server authorises them by name (invariant 3).
 */

import { z } from 'zod';

import { SheetIdSchema } from '../ids.js';
import { ParticipantRoleSchema } from './session.js';
import { StrokeStyleSchema } from './stroke.js';

/** Kinds of realtime documents. */
export const DOC_KINDS = ['session', 'sheet'] as const;

/** Kind of realtime document. */
export type DocKind = (typeof DOC_KINDS)[number];

const DOC_NAME_PATTERN =
  /^(session|sheet):([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

/**
 * Builds the realtime document name for a session or sheet.
 *
 * @param {DocKind} kind - `'session'` or `'sheet'`.
 * @param {string} id - The session or sheet id.
 * @returns {string} The document name, for example `sheet:0192…`.
 */
export function docName(kind: DocKind, id: string): string {
  return `${kind}:${id}`;
}

/** Result of parsing a document name. */
export interface ParsedDocName {
  /** Which kind of document. */
  readonly kind: DocKind;
  /** The session or sheet id, lower-cased. */
  readonly id: string;
}

/**
 * Parses a realtime document name.
 *
 * @param {string} name - Document name received from a client.
 * @returns {ParsedDocName | null} The kind and id, or null if the name is malformed.
 */
export function parseDocName(name: string): ParsedDocName | null {
  const match = DOC_NAME_PATTERN.exec(name);
  if (!match) return null;
  const kind = match[1] as DocKind;
  const id = (match[2] ?? '').toLowerCase();
  return { kind, id };
}

/** Keys inside the session document. */
export const SESSION_DOC_KEYS = {
  /** `Y.Map` of session-level settings. */
  meta: 'meta',
  /** `Y.Array<SheetId>` of sheets in display order. */
  sheetOrder: 'sheetOrder',
  /** Key in `meta`: the sheet the mentor is currently showing. */
  currentSheetId: 'currentSheetId',
  /** Key in `meta`: whether the student may write right now. */
  studentCanWrite: 'studentCanWrite',
} as const;

/** Keys inside a sheet document. */
export const SHEET_DOC_KEYS = {
  /** `Y.Map<StrokeId, StrokeRecord>` of committed strokes. */
  strokes: 'strokes',
  /** `Y.Map` of sheet-level settings. */
  meta: 'meta',
  /** Key in `meta`: live sheet height in sheet units (grows with "add space"). */
  heightUnits: 'heightUnits',
} as const;

/** The in-progress stroke of one connection, streamed over awareness. */
export const LivePenSchema = z.object({
  sheetId: SheetIdSchema,
  style: StrokeStyleSchema,
  /** Flat `[x, y, pressure, …]` points in sheet units. */
  points: z.array(z.number()),
});

/** Parsed live pen. */
export type LivePen = z.infer<typeof LivePenSchema>;

/** Ephemeral per-connection state shared through Yjs awareness. */
export const AwarenessStateSchema = z.object({
  user: z.object({
    id: z.string().min(1),
    name: z.string().min(1).max(100),
    role: ParticipantRoleSchema,
    /** Colour used for this person's cursor and presence badge. */
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  }),
  /** Sheet this connection is looking at, or null before the first sheet loads. */
  viewingSheetId: SheetIdSchema.nullable(),
  /** Student only: whether their view follows the mentor's current sheet. */
  followMentor: z.boolean(),
  /** Stroke in progress, or null when the pen is up. */
  pen: LivePenSchema.nullable(),
});

/** Parsed awareness state. */
export type AwarenessState = z.infer<typeof AwarenessStateSchema>;

/** Connection status of the realtime client, as shown in the UI. */
export const CONNECTION_STATUSES = [
  'connecting',
  'connected',
  'disconnected',
  'unauthorized',
  'readonly',
] as const;

/** Realtime connection status. */
export type ConnectionStatus = (typeof CONNECTION_STATUSES)[number];
