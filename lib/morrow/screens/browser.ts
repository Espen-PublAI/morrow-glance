import type { ScreenProfile } from '@/lib/morrow/types';

/** Any modern browser at a 1080p reference size; the layout adapts from there. */
export const browserScreen: ScreenProfile = {
  id: 'browser',
  name: 'Browser · adaptive',
  width: 1920,
  height: 1080,
  refreshSeconds: 30,
};
