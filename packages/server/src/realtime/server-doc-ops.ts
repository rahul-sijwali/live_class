/**
 * Server-side edits to realtime documents (no socket involved).
 *
 * Owns: appending newly created sheets to a session document after `openQuestion`. Uses
 * the same keys as the client's `SessionDoc` (from `@live-class/shared`), so both sides
 * agree on the shape without the server importing browser code.
 */

import { type Hocuspocus } from '@hocuspocus/server';
import type * as Y from 'yjs';

import { docName, SESSION_DOC_KEYS, type SessionId, type SheetId } from '@live-class/shared';

/**
 * Appends sheets to a session's `sheetOrder` and optionally makes the first new one
 * current. Ids already present are skipped.
 *
 * @param {Hocuspocus} hocuspocus - The realtime server.
 * @param {SessionId} sessionId - Session whose document to edit.
 * @param {readonly SheetId[]} sheetIds - New sheets in order.
 * @param {boolean} makeCurrent - Whether to switch `currentSheetId` to the first new sheet.
 * @returns {Promise<void>} Resolves once the change is applied (and queued for persistence).
 */
export async function appendSheetsToSession(
  hocuspocus: Hocuspocus,
  sessionId: SessionId,
  sheetIds: readonly SheetId[],
  makeCurrent: boolean,
): Promise<void> {
  if (sheetIds.length === 0) return;
  const connection = await hocuspocus.openDirectConnection(docName('session', sessionId), {
    server: true,
  });
  try {
    await connection.transact((doc: Y.Doc) => {
      const order = doc.getArray<string>(SESSION_DOC_KEYS.sheetOrder);
      const meta = doc.getMap<string | boolean>(SESSION_DOC_KEYS.meta);
      const existing = new Set(order.toArray());
      const fresh = sheetIds.filter((id) => !existing.has(id));
      if (fresh.length === 0) return;
      order.push([...fresh]);
      const first = fresh[0];
      if (makeCurrent && first !== undefined) meta.set(SESSION_DOC_KEYS.currentSheetId, first);
    });
  } finally {
    await connection.disconnect();
  }
}
