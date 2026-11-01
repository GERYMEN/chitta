import {
  BUTTON_RADIUS,
  BUTTON_SIZE,
  centerYBounds,
  clampCenterY,
  dockedX,
  expandedX,
  initialWidgetState,
  isDragGesture,
  isWidgetVisible,
  parsePosition,
  serializePosition,
  sideForCenterX,
  WidgetLayout,
  widgetReducer,
  WidgetState,
} from '../widgetMachine';

const LAYOUT: WidgetLayout = { width: 400, height: 800, insetTop: 24, insetBottom: 16 };

function state(mode: WidgetState['mode'], overrides: Partial<WidgetState> = {}): WidgetState {
  return { mode, side: 'right', centerY: 400, ...overrides };
}

describe('feedback widget reducer (R4c)', () => {
  it('starts DOCKED on the right inside the Y band', () => {
    const initial = initialWidgetState(LAYOUT);
    expect(initial.mode).toBe('DOCKED');
    expect(initial.side).toBe('right');
    const { min, max } = centerYBounds(LAYOUT);
    expect(initial.centerY).toBeGreaterThanOrEqual(min);
    expect(initial.centerY).toBeLessThanOrEqual(max);
  });

  it('tap on DOCKED only expands; tap on EXPANDED captures; capture opens the sheet', () => {
    const expanded = widgetReducer(state('DOCKED'), { type: 'TAP' });
    expect(expanded.mode).toBe('EXPANDED');
    const capturing = widgetReducer(expanded, { type: 'TAP' });
    expect(capturing.mode).toBe('CAPTURING_SCREENSHOT');
    const open = widgetReducer(capturing, { type: 'CAPTURE_DONE' });
    expect(open.mode).toBe('FEEDBACK_MODAL_OPEN');
    expect(widgetReducer(open, { type: 'SHEET_CLOSED' }).mode).toBe('DOCKED');
  });

  it('screen reader: one tap on DOCKED goes straight to capture → sheet', () => {
    const next = widgetReducer(state('DOCKED'), { type: 'TAP', screenReader: true });
    expect(next.mode).toBe('CAPTURING_SCREENSHOT');
  });

  it('3 s idle timer collapses EXPANDED via SNAPPING to DOCKED; ignored elsewhere', () => {
    const snapping = widgetReducer(state('EXPANDED'), { type: 'IDLE_TIMEOUT' });
    expect(snapping.mode).toBe('SNAPPING');
    expect(widgetReducer(snapping, { type: 'SNAP_DONE' }).mode).toBe('DOCKED');
    for (const mode of ['DOCKED', 'DRAGGING', 'CAPTURING_SCREENSHOT', 'FEEDBACK_MODAL_OPEN'] as const) {
      expect(widgetReducer(state(mode), { type: 'IDLE_TIMEOUT' }).mode).toBe(mode);
    }
  });

  it('drag from DOCKED / EXPANDED / SNAPPING, never from capture or the open sheet', () => {
    for (const mode of ['DOCKED', 'EXPANDED', 'SNAPPING'] as const) {
      expect(widgetReducer(state(mode), { type: 'DRAG_START' }).mode).toBe('DRAGGING');
    }
    for (const mode of ['CAPTURING_SCREENSHOT', 'FEEDBACK_MODAL_OPEN'] as const) {
      expect(widgetReducer(state(mode), { type: 'DRAG_START' }).mode).toBe(mode);
    }
  });

  it('drag threshold: movement ≥ 6dp is a drag, less is a tap', () => {
    expect(isDragGesture(0, 0)).toBe(false);
    expect(isDragGesture(3, 4)).toBe(false); // 5dp
    expect(isDragGesture(5.9, 0)).toBe(false);
    expect(isDragGesture(6, 0)).toBe(true);
    expect(isDragGesture(0, -6)).toBe(true);
    expect(isDragGesture(-4, 5)).toBe(true); // ≈6.4dp
  });

  it('release snaps to the nearest horizontal edge and keeps the (clamped) release Y', () => {
    const left = widgetReducer(state('DRAGGING'), {
      type: 'RELEASE',
      centerX: 199,
      centerY: 500,
      layout: LAYOUT,
    });
    expect(left).toEqual({ mode: 'SNAPPING', side: 'left', centerY: 500 });
    const right = widgetReducer(state('DRAGGING', { side: 'left' }), {
      type: 'RELEASE',
      centerX: 200,
      centerY: 300,
      layout: LAYOUT,
    });
    expect(right).toEqual({ mode: 'SNAPPING', side: 'right', centerY: 300 });
    expect(sideForCenterX(10, 400)).toBe('left');
    expect(sideForCenterX(390, 400)).toBe('right');
    // RELEASE outside DRAGGING is ignored.
    expect(widgetReducer(state('DOCKED'), { type: 'RELEASE', centerX: 0, centerY: 0, layout: LAYOUT })).toEqual(
      state('DOCKED'),
    );
  });

  it('Y is clamped between top inset + header + radius and bottom bar + inset + radius', () => {
    const { min, max } = centerYBounds(LAYOUT);
    expect(min).toBe(24 + 72 + BUTTON_RADIUS);
    expect(max).toBe(800 - 16 - 88 - BUTTON_RADIUS);
    expect(clampCenterY(0, LAYOUT)).toBe(min);
    expect(clampCenterY(10_000, LAYOUT)).toBe(max);
    const released = widgetReducer(state('DRAGGING'), {
      type: 'RELEASE',
      centerX: 300,
      centerY: 5,
      layout: LAYOUT,
    });
    expect(released.centerY).toBe(min);
    // A tiny screen never inverts the band.
    const tiny = { width: 200, height: 150, insetTop: 0, insetBottom: 0 };
    expect(centerYBounds(tiny).max).toBeGreaterThanOrEqual(centerYBounds(tiny).min);
  });

  it('docked = ~35% visible at the edge; expanded = fully visible 16dp from the edge', () => {
    const visibleLeft = dockedX('left', LAYOUT) + BUTTON_SIZE;
    expect(visibleLeft).toBeCloseTo(BUTTON_SIZE * 0.35, 5);
    const visibleRight = LAYOUT.width - dockedX('right', LAYOUT);
    expect(visibleRight).toBeCloseTo(BUTTON_SIZE * 0.35, 5);
    expect(expandedX('left', LAYOUT)).toBe(16);
    expect(expandedX('right', LAYOUT)).toBe(400 - 16 - BUTTON_SIZE);
  });

  it('retake / add recaptures from the open sheet; RESTORE applies a saved position when docked', () => {
    expect(widgetReducer(state('FEEDBACK_MODAL_OPEN'), { type: 'RECAPTURE' }).mode).toBe(
      'CAPTURING_SCREENSHOT',
    );
    expect(widgetReducer(state('DOCKED'), { type: 'RESTORE', side: 'left', centerY: 333 })).toEqual({
      mode: 'DOCKED',
      side: 'left',
      centerY: 333,
    });
    expect(widgetReducer(state('EXPANDED'), { type: 'RESTORE', side: 'left', centerY: 333 }).side).toBe(
      'right',
    );
  });
});

describe('feedback widget visibility (R4c)', () => {
  const base = {
    routeName: 'Home',
    keyboardOpen: false,
    mode: 'DOCKED' as const,
    tourActive: false,
    tourPointsAtWidget: false,
  };

  it('shown on main screens, hidden on onboarding / setup / form screens', () => {
    expect(isWidgetVisible(base)).toBe(true);
    expect(isWidgetVisible({ ...base, routeName: 'TransactionDetail' })).toBe(true);
    for (const routeName of ['Onboarding', 'ProfileSetup', 'Permissions', 'SyncStart', 'AddRecord', 'EditTransaction', 'AddAccount']) {
      expect(isWidgetVisible({ ...base, routeName })).toBe(false);
    }
    expect(isWidgetVisible({ ...base, routeName: null })).toBe(false);
  });

  it('hidden with the keyboard open, while capturing (excluded from the image) and while the sheet is open', () => {
    expect(isWidgetVisible({ ...base, keyboardOpen: true })).toBe(false);
    expect(isWidgetVisible({ ...base, mode: 'CAPTURING_SCREENSHOT' })).toBe(false);
    expect(isWidgetVisible({ ...base, mode: 'FEEDBACK_MODAL_OPEN' })).toBe(false);
  });

  it('during the tour only on the step that points at it', () => {
    expect(isWidgetVisible({ ...base, tourActive: true })).toBe(false);
    expect(isWidgetVisible({ ...base, tourActive: true, tourPointsAtWidget: true })).toBe(true);
  });
});

describe('feedback widget saved position (R4c)', () => {
  it('round-trips side + Y and rejects junk', () => {
    expect(parsePosition(serializePosition({ side: 'left', centerY: 412.6 }))).toEqual({
      side: 'left',
      centerY: 413,
    });
    expect(parsePosition(null)).toBeNull();
    expect(parsePosition('not json')).toBeNull();
    expect(parsePosition('{"side":"top","centerY":10}')).toBeNull();
    expect(parsePosition('{"side":"right"}')).toBeNull();
  });
});
