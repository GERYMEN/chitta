/**
 * R4c pure state machine + geometry for the floating feedback button.
 *
 *   DOCKED --tap--> EXPANDED --tap--> CAPTURING_SCREENSHOT --done--> FEEDBACK_MODAL_OPEN
 *   EXPANDED --3000 ms no touch--> SNAPPING --spring end--> DOCKED
 *   DOCKED | EXPANDED | SNAPPING --drag (≥ 6dp)--> DRAGGING --release--> SNAPPING
 *   FEEDBACK_MODAL_OPEN --close / send--> DOCKED;  --retake / add--> CAPTURING_SCREENSHOT
 *
 * A tap on DOCKED only expands. With a screen reader on, a single tap on
 * DOCKED goes straight to capture → sheet (the two-tap pattern is hostile to
 * TalkBack).
 */
export type WidgetMode =
  | 'DOCKED'
  | 'EXPANDED'
  | 'DRAGGING'
  | 'SNAPPING'
  | 'CAPTURING_SCREENSHOT'
  | 'FEEDBACK_MODAL_OPEN';

export type DockSide = 'left' | 'right';

export interface WidgetState {
  mode: WidgetMode;
  side: DockSide;
  /** Button centre Y in the overlay (root) coordinate space, dp. */
  centerY: number;
}

export interface WidgetLayout {
  width: number;
  height: number;
  insetTop: number;
  insetBottom: number;
}

export const BUTTON_SIZE = 52;
export const BUTTON_RADIUS = BUTTON_SIZE / 2;
/** Docked: ~35% of the button visible, ~65% off-screen. */
export const DOCK_VISIBLE_FRACTION = 0.35;
export const EXPANDED_EDGE_MARGIN = 16;
export const DRAG_THRESHOLD = 6;
export const IDLE_COLLAPSE_MS = 3000;
/** Top safe area + header, and bottom tab bar + safe area (approx., dp). */
export const TOP_CHROME = 72;
export const BOTTOM_CHROME = 88;
export const DOCKED_OPACITY = 0.3;
export const DRAG_SCALE = 1.08;

export type WidgetEvent =
  | { type: 'TAP'; screenReader?: boolean }
  | { type: 'DRAG_START' }
  | { type: 'RELEASE'; centerX: number; centerY: number; layout: WidgetLayout }
  | { type: 'IDLE_TIMEOUT' }
  | { type: 'SNAP_DONE' }
  | { type: 'CAPTURE_DONE' }
  | { type: 'SHEET_CLOSED' }
  | { type: 'RECAPTURE' }
  | { type: 'RESTORE'; side: DockSide; centerY: number };

export function initialWidgetState(layout: WidgetLayout): WidgetState {
  return { mode: 'DOCKED', side: 'right', centerY: defaultCenterY(layout) };
}

/** Lower third of the usable band — clear of the header and the tab bar. */
export function defaultCenterY(layout: WidgetLayout): number {
  const { min, max } = centerYBounds(layout);
  return clamp(min + (max - min) * 0.7, min, max);
}

export function centerYBounds(layout: WidgetLayout): { min: number; max: number } {
  const min = layout.insetTop + TOP_CHROME + BUTTON_RADIUS;
  const max = layout.height - layout.insetBottom - BOTTOM_CHROME - BUTTON_RADIUS;
  return { min, max: Math.max(min, max) };
}

export function clampCenterY(centerY: number, layout: WidgetLayout): number {
  const { min, max } = centerYBounds(layout);
  return clamp(centerY, min, max);
}

/** Nearest horizontal edge for a release point. */
export function sideForCenterX(centerX: number, width: number): DockSide {
  return centerX < width / 2 ? 'left' : 'right';
}

/** Movement of at least 6dp turns a tap into a drag. */
export function isDragGesture(dx: number, dy: number): boolean {
  return Math.hypot(dx, dy) >= DRAG_THRESHOLD;
}

/** Left edge (translateX) of the button when docked: 65% off-screen. */
export function dockedX(side: DockSide, layout: Pick<WidgetLayout, 'width'>): number {
  const hidden = BUTTON_SIZE * (1 - DOCK_VISIBLE_FRACTION);
  return side === 'left' ? -hidden : layout.width - BUTTON_SIZE + hidden;
}

/** Left edge when expanded: fully visible, 16dp from the edge. */
export function expandedX(side: DockSide, layout: Pick<WidgetLayout, 'width'>): number {
  return side === 'left'
    ? EXPANDED_EDGE_MARGIN
    : layout.width - EXPANDED_EDGE_MARGIN - BUTTON_SIZE;
}

/** True when a mode shows the button fully (EXPANDED-like visual). */
export function isExpandedVisual(mode: WidgetMode): boolean {
  return mode === 'EXPANDED' || mode === 'CAPTURING_SCREENSHOT' || mode === 'FEEDBACK_MODAL_OPEN';
}

export function widgetReducer(state: WidgetState, event: WidgetEvent): WidgetState {
  switch (event.type) {
    case 'TAP':
      if (state.mode === 'DOCKED' || state.mode === 'SNAPPING') {
        return { ...state, mode: event.screenReader ? 'CAPTURING_SCREENSHOT' : 'EXPANDED' };
      }
      if (state.mode === 'EXPANDED') return { ...state, mode: 'CAPTURING_SCREENSHOT' };
      return state;
    case 'DRAG_START':
      if (state.mode === 'DOCKED' || state.mode === 'EXPANDED' || state.mode === 'SNAPPING') {
        return { ...state, mode: 'DRAGGING' };
      }
      return state;
    case 'RELEASE':
      if (state.mode !== 'DRAGGING') return state;
      return {
        mode: 'SNAPPING',
        side: sideForCenterX(event.centerX, event.layout.width),
        centerY: clampCenterY(event.centerY, event.layout),
      };
    case 'IDLE_TIMEOUT':
      return state.mode === 'EXPANDED' ? { ...state, mode: 'SNAPPING' } : state;
    case 'SNAP_DONE':
      return state.mode === 'SNAPPING' ? { ...state, mode: 'DOCKED' } : state;
    case 'CAPTURE_DONE':
      return state.mode === 'CAPTURING_SCREENSHOT'
        ? { ...state, mode: 'FEEDBACK_MODAL_OPEN' }
        : state;
    case 'SHEET_CLOSED':
      return state.mode === 'FEEDBACK_MODAL_OPEN' ? { ...state, mode: 'DOCKED' } : state;
    case 'RECAPTURE':
      return state.mode === 'FEEDBACK_MODAL_OPEN'
        ? { ...state, mode: 'CAPTURING_SCREENSHOT' }
        : state;
    case 'RESTORE':
      return state.mode === 'DOCKED'
        ? { ...state, side: event.side, centerY: event.centerY }
        : state;
    default:
      return state;
  }
}

// ---- visibility -------------------------------------------------------------

/** Onboarding/setup + form screens: no floating button. */
export const WIDGET_HIDDEN_ROUTES: ReadonlySet<string> = new Set([
  'Onboarding',
  'ProfileSetup',
  'Permissions',
  'SyncStart',
  'AddRecord',
  'EditTransaction',
  'AddAccount',
]);

export function isWidgetVisible(input: {
  routeName: string | null;
  keyboardOpen: boolean;
  mode: WidgetMode;
  tourActive: boolean;
  tourPointsAtWidget: boolean;
}): boolean {
  if (!input.routeName || WIDGET_HIDDEN_ROUTES.has(input.routeName)) return false;
  if (input.tourActive) return input.tourPointsAtWidget;
  if (input.keyboardOpen) return false;
  // Excluded from its own screenshot, and hidden while the sheet is open.
  return input.mode !== 'CAPTURING_SCREENSHOT' && input.mode !== 'FEEDBACK_MODAL_OPEN';
}

// ---- persisted position -----------------------------------------------------

export interface StoredPosition {
  side: DockSide;
  centerY: number;
}

export function serializePosition(position: StoredPosition): string {
  return JSON.stringify({ side: position.side, centerY: Math.round(position.centerY) });
}

export function parsePosition(value: string | null): StoredPosition | null {
  if (!value) return null;
  try {
    const raw = JSON.parse(value) as Partial<StoredPosition>;
    if ((raw.side === 'left' || raw.side === 'right') && Number.isFinite(raw.centerY)) {
      return { side: raw.side, centerY: Number(raw.centerY) };
    }
  } catch {
    // ignore a malformed value
  }
  return null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
