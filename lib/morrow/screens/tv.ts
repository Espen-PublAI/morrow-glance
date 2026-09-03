import type { ScreenProfile } from '@/lib/morrow/types';

/** A 4K television or large signage panel running a kiosk browser. */
export const tvScreen: ScreenProfile = {
  id: 'tv-4k',
  name: 'TV · 4K',
  width: 3840,
  height: 2160,
  refreshSeconds: 60,
};
