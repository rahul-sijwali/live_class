'use client';
/**
 * The class screen: toolbar, sheet tabs, the writable sheet, presence, and (for mentors)
 * the question picker.
 *
 * Owns: toolbar state and the wiring between the room store, `SheetStage` and the mentor
 * controls. Data and realtime live in `RoomStore` (core).
 */

import { useCallback, useMemo, useRef, useState } from 'react';

import { type ActiveTool, type SheetController, StrokeRenderer } from '@live-class/core';
import {
  canControlSession,
  canDraw,
  DEFAULT_PEN_COLOR_BY_ROLE,
  DEFAULT_PEN_SIZE_UNITS,
  type SessionId,
  type SessionQuestion,
  type StrokeStyle,
} from '@live-class/shared';

import { useLiveClass } from '../context.js';
import { useAsync } from '../hooks/useAsync.js';
import { useRoom } from '../hooks/useRoom.js';
import { PresenceBar } from './PresenceBar.js';
import { QuestionPicker } from './QuestionPicker.js';
import { type SheetHistoryState, SheetStage } from './SheetStage.js';
import { SheetTabs } from './SheetTabs.js';
import { Toolbar } from './Toolbar.js';

/** Which session to join and how to start. */
export interface LiveClassRoomProps {
  readonly sessionId: SessionId;
  /** Tool selected when the room opens. */
  readonly initialTool?: ActiveTool;
}

/**
 * Shows one live class to the current user: the mentor gets drawing tools, sheet control
 * and the question picker; the student gets drawing tools and follow mode; an admin
 * observes read-only.
 *
 * @param {LiveClassRoomProps} props - Session to join and the starting tool.
 * @returns {JSX.Element} The whole room, a loading notice, or an error notice.
 */
export function LiveClassRoom(props: LiveClassRoomProps): React.JSX.Element {
  const { api, user, reportError } = useLiveClass();
  const { snapshot: room, store } = useRoom(props.sessionId);
  const role = room.role ?? 'mentor';
  const isObserver = room.role === null;
  const [tool, setTool] = useState<ActiveTool>(props.initialTool ?? 'pen');
  const [style, setStyle] = useState<StrokeStyle>(() => ({
    tool: 'pen',
    color: DEFAULT_PEN_COLOR_BY_ROLE[role],
    sizeUnits: DEFAULT_PEN_SIZE_UNITS,
  }));
  const [fingerDraws, setFingerDraws] = useState(false);
  const [history, setHistory] = useState({ canUndo: false, canRedo: false });
  const controllerRef = useRef<SheetController | null>(null);
  const renderer = useMemo(() => new StrokeRenderer(), []);
  const canPick = (role === 'mentor' || isObserver) && room.status === 'ready';
  const attached = useAsync(
    () =>
      canPick
        ? api.call('listSessionQuestions', { params: { id: props.sessionId } })
        : Promise.resolve([] as SessionQuestion[]),
    `${props.sessionId}|${String(canPick)}|${room.sheets.length}`,
  );

  const sessionEnded = room.session?.status === 'ended';
  const readOnly = isObserver || sessionEnded || room.connection === 'readonly';
  // The toolbar also locks when the mentor has switched off student writing.
  const drawingLocked = readOnly || !canDraw(role, room.live.studentCanWrite);
  const viewingSheet = room.sheets.find((sheet) => sheet.id === room.viewingSheetId) ?? null;
  const viewingQuestion = viewingSheet
    ? (room.questions.get(viewingSheet.questionId) ?? null)
    : null;

  const onHistoryChange = useCallback((state: SheetHistoryState) => {
    setHistory({ canUndo: state.canUndo, canRedo: state.canRedo });
  }, []);

  /**
   * Ends the session after confirmation.
   *
   * @returns {Promise<void>} Resolves when done.
   */
  const endSession = async (): Promise<void> => {
    if (typeof window !== 'undefined' && !window.confirm('End this class for everyone?')) return;
    try {
      await api.call('endSession', { params: { id: props.sessionId } });
      await store.refresh();
    } catch (caught) {
      reportError(caught);
    }
  };

  if (room.status === 'error') {
    return (
      <div className="lc-notice lc-notice-error" role="alert">
        Could not open this class ({room.error?.code}): {room.error?.message}
      </div>
    );
  }
  const presence = store.presence;
  if (room.status === 'loading' || !room.session || !presence) {
    return <div className="lc-notice">Loading class…</div>;
  }

  return (
    <div className="lc-room" data-testid="lc-room">
      <header className="lc-room-header">
        <h2 className="lc-room-title">{room.session.title}</h2>
        <PresenceBar me={user} myRole={room.role} peers={room.peers} connection={room.connection} />
      </header>

      <Toolbar
        role={role}
        tool={tool}
        style={style}
        fingerDraws={fingerDraws}
        canUndo={history.canUndo}
        canRedo={history.canRedo}
        readOnly={drawingLocked}
        studentCanWrite={room.live.studentCanWrite}
        followMentor={room.followMentor}
        sessionEnded={sessionEnded}
        onToolChange={setTool}
        onStyleChange={setStyle}
        onFingerDrawsChange={setFingerDraws}
        onUndo={() => controllerRef.current?.undo()}
        onRedo={() => controllerRef.current?.redo()}
        onAddSpace={() => {
          try {
            controllerRef.current?.addSpace();
          } catch (caught) {
            reportError(caught);
          }
        }}
        onStudentCanWriteChange={(allowed) => {
          if (canControlSession(role) && !isObserver) store.setStudentCanWrite(allowed);
        }}
        onFollowMentorChange={(follow) => {
          store.setFollowMentor(follow);
        }}
        onEndSession={() => void endSession()}
      />

      <SheetTabs
        sheets={room.sheets}
        order={room.live.sheetOrder}
        questions={room.questions}
        currentSheetId={room.live.currentSheetId}
        viewingSheetId={room.viewingSheetId}
        onSelect={(sheetId) => {
          store.viewSheet(sheetId);
          if (role === 'mentor' && !isObserver) {
            try {
              store.setCurrentSheet(sheetId);
            } catch (caught) {
              reportError(caught);
            }
          }
        }}
      />

      <div className="lc-room-body">
        <main className="lc-room-main">
          {viewingSheet && viewingQuestion ? (
            <SheetStage
              key={viewingSheet.id}
              sheet={viewingSheet}
              question={viewingQuestion}
              role={role}
              presence={presence}
              tool={tool}
              style={style}
              fingerDraws={fingerDraws}
              readOnly={readOnly}
              studentCanWrite={room.live.studentCanWrite}
              renderer={renderer}
              controllerRef={controllerRef}
              onChange={onHistoryChange}
            />
          ) : (
            <div className="lc-empty">
              {role === 'mentor' && !isObserver
                ? 'Open a question from the panel to start writing.'
                : 'Waiting for the mentor to open a question…'}
            </div>
          )}
        </main>
        {canPick && !sessionEnded ? (
          <QuestionPicker
            sessionId={props.sessionId}
            attached={attached.data ?? []}
            onOpened={() => {
              attached.reload();
              void store.refresh();
            }}
          />
        ) : null}
      </div>
    </div>
  );
}
