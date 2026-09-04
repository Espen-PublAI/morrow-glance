import { browserScreen } from '@/lib/morrow/screens/browser';
import type {
  FooterFields,
  GlanceLayout,
  ScreenProfile,
} from '@/lib/morrow/types';

/** Grid used for new pages. */
export const DEFAULT_LAYOUT: GlanceLayout = { columns: 12, rows: 5 };

/** Seconds between page rotations for a fresh install. */
export const DEFAULT_ROTATION_SECONDS = 30;

/** A clean install shows everything in the footer; Admin can turn each off. */
export const DEFAULT_FOOTER: FooterFields = {
  date: true,
  location: true,
  time: true,
};

/** A clean install has one screen: the browser. Others are added in Admin. */
export const DEFAULT_SCREENS: ScreenProfile[] = [browserScreen];
export const DEFAULT_SCREEN_ID = browserScreen.id;
