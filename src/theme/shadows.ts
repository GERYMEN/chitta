import { ViewStyle } from 'react-native';

/**
 * Elevation tokens — hairline borders over heavy shadows (docs/DESIGN.md).
 * Level 0/1 rely on `outlineVariant` hairline borders, not shadow.
 * Level 2 is reserved for bottom sheets / modals.
 */
export const shadows: Record<string, ViewStyle> = {
  level0: {},
  level1: {},
  level2: {
    shadowColor: '#0B0E11',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.08,
    shadowRadius: 32,
    elevation: 8,
  },
  level3: {
    shadowColor: '#0B0E11',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.06,
    shadowRadius: 12,
    elevation: 4,
  },
};
