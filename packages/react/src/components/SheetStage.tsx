'use client';
/**
 * Mounts a core `SheetController` for one sheet inside a scrollable container.
 *
 * Owns: the React ↔ imperative bridge: opening the sheet's realtime document, creating and
 * disposing the controller, and forwarding tool state. The controller does the real work.
 */

import { type RefObject, useEffect, useEffectEvent, useRef, useState } from 'react';

import {
  type ActiveTool,
  type Presence,
  SheetController,
  SheetDoc,
  type StrokeRenderer,
} from '@live-class/core';
import {
  type AppError,
  docName,
  type ParticipantRole,
  type Question,
  type Sheet,
  type StrokeStyle,
} from '@live-class/shared';

import { useLiveClass } from '../context.js';

/** Undo/redo availability reported by the stage. */
export interface SheetHistoryState {
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly strokeCount: number;
}

/** Sheet, question, identity and tool state the stage needs. */
export interface SheetStageProps {
  readonly sheet: Sheet;
  readonly question: Question;
  readonly role: ParticipantRole;
  readonly presence: Presence;
  readonly tool: ActiveTool;
  readonly style: StrokeStyle;
  readonly fingerDraws: boolean;
  /** External read-only flag (session ended, observer, connection read-only). */
  readonly readOnly: boolean;
  readonly studentCanWrite: boolean;
  /** Shared renderer so stroke paths stay cached across sheet switches. */
  readonly renderer: StrokeRenderer;
  /** Receives the live controller so the toolbar can call undo/redo/addSpace. */
  readonly controllerRef: RefObject<SheetController | null>;
  /** Undo/redo availability changed. */
  readonly onChange?: (state: SheetHistoryState) => void;
  /** Called when the sheet content is laid out. */
  readonly onReady?: () => void;
}

/**
 * The writable area: question content with the ink canvases on top, inside a scroll
 * container sized by the host layout.
 *
 * @param {SheetStageProps} props - Sheet, question, user role and tool state.
 * @returns {JSX.Element} A scroll container the controller renders into.
 */
export function SheetStage(props: SheetStageProps): React.JSX.Element {
  const { sheet, question, role, presence, renderer, controllerRef } = props;
  const { api, realtime, user, getToken, reportError } = useLiveClass();
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<AppError | null>(null);
  const emitChange = useEffectEvent((state: SheetHistoryState) => {
    props.onChange?.(state);
  });
  const emitReady = useEffectEvent(() => {
    props.onReady?.();
  });
  const readInputs = useEffectEvent(() => ({ sheet, question }));
  const readSettings = useEffectEvent(() => ({
    tool: props.tool,
    style: props.style,
    fingerDraws: props.fingerDraws,
    readOnly: props.readOnly,
    studentCanWrite: props.studentCanWrite,
  }));

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;
    let disposed = false;
    // Keyed by ids below: a refetched sheet/question with the same id must not remount the
    // document connection (reconnecting instantly races the server's document unload).
    const { sheet: currentSheet, question: currentQuestion } = readInputs();
    const connected = realtime.openDoc(docName('sheet', currentSheet.id));
    const sheetDoc = new SheetDoc(connected.doc);
    const initial = readSettings();
    const controller = new SheetController({
      container,
      sheet: currentSheet,
      question: currentQuestion,
      assetUrl: currentQuestion.asset ? api.assetFileUrl(currentQuestion.asset.id) : null,
      getToken,
      user: { id: user.id, role },
      sheetDoc,
      presence,
      initialTool: initial.tool,
      initialStyle: initial.style,
      fingerDraws: initial.fingerDraws,
      readOnly: initial.readOnly || connected.readOnly,
      studentCanWrite: initial.studentCanWrite,
      renderer,
    });
    controllerRef.current = controller;
    const offError = controller.on('error', (caught) => {
      setError(reportError(caught));
    });
    const offChange = controller.on('change', (state) => {
      // Exposed for tests and assistive tooling; cheap and always accurate.
      container.dataset['strokeCount'] = String(state.strokeCount);
      emitChange(state);
    });
    const offReady = controller.on('ready', () => {
      emitReady();
    });
    const offStatus = connected.on('status', (status) => {
      container.dataset['connection'] = status;
      controller.setPermissions({ readOnly: readSettings().readOnly || status === 'readonly' });
    });
    const offSynced = connected.on('synced', () => {
      container.dataset['synced'] = 'true';
    });
    container.dataset['connection'] = connected.status;
    container.dataset['synced'] = String(connected.synced);
    controller.mount().catch((caught: unknown) => {
      if (!disposed) setError(reportError(caught));
    });
    return () => {
      disposed = true;
      offError();
      offChange();
      offReady();
      offStatus();
      offSynced();
      if (controllerRef.current === controller) controllerRef.current = null;
      controller.dispose();
      sheetDoc.dispose();
      connected.close();
    };
  }, [
    api,
    realtime,
    user.id,
    getToken,
    reportError,
    sheet.id,
    question.id,
    role,
    presence,
    renderer,
    controllerRef,
  ]);

  useEffect(() => {
    controllerRef.current?.setTool(props.tool);
  }, [props.tool, controllerRef]);
  useEffect(() => {
    controllerRef.current?.setStyle(props.style);
  }, [props.style, controllerRef]);
  useEffect(() => {
    controllerRef.current?.setFingerDraws(props.fingerDraws);
  }, [props.fingerDraws, controllerRef]);
  useEffect(() => {
    controllerRef.current?.setPermissions({
      readOnly: props.readOnly,
      studentCanWrite: props.studentCanWrite,
    });
  }, [props.readOnly, props.studentCanWrite, controllerRef]);

  return (
    <div className="lc-stage-container" ref={containerRef} data-testid="lc-sheet-stage">
      {error ? (
        <div className="lc-notice lc-notice-error" role="alert">
          This sheet could not be shown ({error.code}): {error.message}
        </div>
      ) : null}
    </div>
  );
}
