import React, { useCallback, useEffect, useRef } from 'react';
import type { View } from 'react-native';

type ViewInstance = React.ComponentRef<typeof View>;
import type { Rect } from './tourLayout';
import type { TourTab, TourTargetKey } from './tourModel';

/**
 * R4c tiny registry: screens register the controls the tour points at
 * (useTourTarget) and scrollable tabs register a scroller, so the overlay can
 * measure targets in WINDOW coordinates and scroll them into view.
 */
export type TargetMeasurer = () => Promise<Rect | null>;

export interface TourScroller {
  /** Scroll content by `dy` (positive = content moves up). */
  scrollBy: (dy: number) => void;
}

const targets = new Map<TourTargetKey, TargetMeasurer>();
const scrollers = new Map<TourTab, TourScroller>();

export function registerTourTarget(key: TourTargetKey, measurer: TargetMeasurer): () => void {
  targets.set(key, measurer);
  return () => {
    if (targets.get(key) === measurer) targets.delete(key);
  };
}

export function hasTourTarget(key: TourTargetKey): boolean {
  return targets.has(key);
}

/** Window rect of a registered target, or null (missing / not laid out). */
export async function measureTourTarget(key: TourTargetKey): Promise<Rect | null> {
  const measurer = targets.get(key);
  if (!measurer) return null;
  try {
    const rect = await measurer();
    return rect && rect.width > 0 && rect.height > 0 ? rect : null;
  } catch {
    return null;
  }
}

export function registerTourScroller(tab: TourTab, scroller: TourScroller): () => void {
  scrollers.set(tab, scroller);
  return () => {
    if (scrollers.get(tab) === scroller) scrollers.delete(tab);
  };
}

export function getTourScroller(tab: TourTab): TourScroller | null {
  return scrollers.get(tab) ?? null;
}

/** Window rect of a native view via measureInWindow. */
export function measureViewInWindow(view: ViewInstance | null): Promise<Rect | null> {
  return new Promise(resolve => {
    if (!view || typeof view.measureInWindow !== 'function') {
      resolve(null);
      return;
    }
    view.measureInWindow((x, y, width, height) => resolve({ x, y, width, height }));
  });
}

/**
 * Attach the returned ref to a View (keep `collapsable={false}`) to make it a
 * tour target while it is mounted.
 */
export function useTourTarget(key: TourTargetKey) {
  const ref = useRef<ViewInstance>(null);
  const measure = useCallback(() => measureViewInWindow(ref.current), []);
  useEffect(() => registerTourTarget(key, measure), [key, measure]);
  return ref;
}

/** Test helper. */
export function resetTourRegistry(): void {
  targets.clear();
  scrollers.clear();
}
