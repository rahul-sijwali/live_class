/**
 * Every tunable number in the system, with the reason for its value.
 *
 * This module owns the constants; it never owns behaviour. Anything that reads one of these
 * values must import it from here rather than repeating the number (CLAUDE.md §5).
 *
 * @packageDocumentation
 */

/**
 * Logical width of every sheet, in sheet units. A sheet is laid out at this width and scaled
 * as a whole to fit the viewport (invariant 1 in CLAUDE.md §14). 1000 keeps coordinates
 * readable (one unit ≈ one CSS pixel on a 1000 px wide screen) while leaving sub-pixel
 * precision to the fractional part.
 */
export const LOGICAL_WIDTH = 1000;

/** Blank space above the question where people can write, in sheet units. */
export const DEFAULT_MARGIN_TOP_UNITS = 120;

/**
 * Blank space below the question, in sheet units. Roughly 60 % of a screen height on a
 * laptop, enough for a few lines of working before "add space" is needed.
 */
export const DEFAULT_MARGIN_BOTTOM_UNITS = 600;

/** How much blank space "add space" appends below the sheet, in sheet units. */
export const ADD_SPACE_STEP_UNITS = 400;

/** Upper bound for a sheet's height so a runaway "add space" cannot create a giant canvas. */
export const MAX_SHEET_HEIGHT_UNITS = 20_000;

/**
 * Provisional height for a text question before the browser has measured it, in sheet
 * units. Overwritten by the first client that measures the real height.
 */
export const PROVISIONAL_TEXT_HEIGHT_UNITS = 400;

/** Largest accepted upload. A pptx slide exported as GIF is typically 2–8 MB. */
export const MAX_UPLOAD_MB = 25;

/** Largest accepted image side in pixels; above this, decoding on phones gets unreliable. */
export const MAX_IMAGE_DIMENSION_PX = 8000;

/** Smallest accepted image side in pixels; anything smaller is not a readable question. */
export const MIN_IMAGE_DIMENSION_PX = 16;

/** Most PDF pages one question may have; each page becomes a sheet in the session. */
export const MAX_PDF_PAGES = 60;

/** Longest Markdown source for a text question, in characters. */
export const MAX_TEXT_MARKDOWN_CHARS = 20_000;

/**
 * Ramer–Douglas–Peucker tolerance for simplifying a finished stroke, in sheet units.
 * 0.75 units is below one device pixel at typical zoom, so simplification is invisible but
 * removes 60–80 % of the points a stylus produces.
 */
export const STROKE_SIMPLIFY_TOLERANCE_UNITS = 0.75;

/**
 * Minimum distance between two consecutive raw stroke points, in sheet units. Points closer
 * than this are jitter and are dropped before rendering.
 */
export const STROKE_MIN_POINT_DISTANCE_UNITS = 0.35;

/** Most points one stroke may hold after simplification; protects the shared document. */
export const MAX_STROKE_POINTS = 4000;

/** Pen width bounds, in sheet units. */
export const MIN_STROKE_SIZE_UNITS = 0.5;
export const MAX_STROKE_SIZE_UNITS = 60;

/** Radius around the eraser pointer within which a stroke is deleted, in sheet units. */
export const ERASER_RADIUS_UNITS = 8;

/**
 * Interval for broadcasting the in-progress stroke over awareness, in milliseconds.
 * ~30 Hz is smooth to the eye and cheap on the wire.
 */
export const AWARENESS_THROTTLE_MS = 33;

/**
 * After a pen touches the surface, finger touches are ignored for this long, in
 * milliseconds. Covers the palm landing shortly before or after the pen.
 */
export const PALM_REJECTION_WINDOW_MS = 500;

/** Default pen colours per role so each person's writing is distinguishable at a glance. */
export const DEFAULT_PEN_COLOR_BY_ROLE = {
  mentor: '#1d4ed8',
  student: '#111827',
} as const;

/** Default pen width, in sheet units. */
export const DEFAULT_PEN_SIZE_UNITS = 2.5;

/** Default highlighter width, in sheet units. */
export const DEFAULT_HIGHLIGHTER_SIZE_UNITS = 14;

/** Maximum tags per question and maximum tag length. */
export const MAX_TAGS_PER_QUESTION = 20;
export const MAX_TAG_LENGTH = 40;

/** Page size for list endpoints. */
export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

/** Longest acceptable client-side wait for a REST call, in milliseconds. */
export const API_TIMEOUT_MS = 15_000;

/** Upload calls get longer because they move real bytes. */
export const UPLOAD_TIMEOUT_MS = 120_000;

/** Realtime reconnect backoff bounds, in milliseconds. */
export const REALTIME_RECONNECT_MIN_MS = 500;
export const REALTIME_RECONNECT_MAX_MS = 15_000;

/** Debounce for persisting a realtime document to the database, in milliseconds. */
export const DOC_PERSIST_DEBOUNCE_MS = 2000;
export const DOC_PERSIST_MAX_WAIT_MS = 10_000;

/** MIME types accepted for uploads. Detected from file content, never from the extension. */
export const ALLOWED_UPLOAD_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'application/pdf',
] as const;

/** Thumbnail width in pixels for question previews. */
export const THUMBNAIL_WIDTH_PX = 320;
