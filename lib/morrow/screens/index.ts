import { browserScreen } from '@/lib/morrow/screens/browser';
import { tabletPortraitScreen } from '@/lib/morrow/screens/tablet-portrait';
import { tvScreen } from '@/lib/morrow/screens/tv';
import type { MorrowConfig, ScreenProfile } from '@/lib/morrow/types';

/**
 * Screen presets: ready-made adaptations a user can add from Admin.
 *
 * To support a new kind of screen, create `lib/morrow/screens/<name>.ts`
 * exporting a `defineScreen({...})` and append it to `screenPresets` below.
 * Presets are plain data; a saved configuration keeps its own copy, so
 * changing a preset never rewrites someone's existing screen.
 */
export const screenPresets: ScreenProfile[] = [
  browserScreen,
  tabletPortraitScreen,
  tvScreen,
];

export function defineScreen<const TScreen extends ScreenProfile>(
  screen: TScreen,
): TScreen {
  return screen;
}

export function findScreen(
  config: MorrowConfig,
  screenId: string | null | undefined,
): ScreenProfile | undefined {
  if (!screenId) return undefined;
  return config.screens.find((screen) => screen.id === screenId);
}

/** The screen the Player follows when none is requested. */
export function defaultScreen(config: MorrowConfig): ScreenProfile {
  const found = findScreen(config, config.defaultScreenId) ?? config.screens[0];
  if (!found) throw new Error('Configuration has no screens.');
  return found;
}

/**
 * The screen a Player should follow: the one named in its URL (`/?screen=id`)
 * when it exists, otherwise the configured default.
 */
export function resolveScreen(
  config: MorrowConfig,
  requestedId: string | null | undefined,
): ScreenProfile {
  return findScreen(config, requestedId) ?? defaultScreen(config);
}

/** Whether a screen is taller than it is wide. */
export function isPortrait(
  screen: Pick<ScreenProfile, 'width' | 'height'>,
): boolean {
  return screen.height > screen.width;
}
