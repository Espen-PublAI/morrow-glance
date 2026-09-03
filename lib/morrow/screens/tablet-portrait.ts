import type { ScreenProfile } from '@/lib/morrow/types';

/** A tablet mounted upright, such as an iPad on a wall bracket. */
export const tabletPortraitScreen: ScreenProfile = {
  id: 'tablet-portrait',
  name: 'Tablet · portrait',
  width: 1024,
  height: 1366,
  refreshSeconds: 30,
};
