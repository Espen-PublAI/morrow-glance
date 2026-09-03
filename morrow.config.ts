import { defineMorrowConfig } from '@/lib/morrow/config';
import {
  DEFAULT_LAYOUT,
  DEFAULT_ROTATION_SECONDS,
  DEFAULT_SCREEN_ID,
  DEFAULT_SCREENS,
} from '@/lib/morrow/defaults';

/**
 * Clean-install fallback. Morrow Server serves this until Admin saves a
 * configuration; the Player also uses it when the server cannot be reached and
 * no local copy exists. Edit it to seed a self-hosted instance.
 */
export const morrowConfig = defineMorrowConfig({
  name: 'Morrow',
  location: '',
  timeZone: 'UTC',
  color: 'white',
  rotationSeconds: DEFAULT_ROTATION_SECONDS,
  defaultScreenId: DEFAULT_SCREEN_ID,
  screens: DEFAULT_SCREENS,
  pages: [
    {
      id: 'glance',
      label: 'Glance',
      layout: DEFAULT_LAYOUT,
      blocks: [],
    },
  ],
  disabledPlugins: [],
});
