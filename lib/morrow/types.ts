import type { ComponentType, ReactNode } from 'react';

/**
 * Morrow contracts.
 *
 * Everything here is plain data or a component type. Validation lives in
 * `config.ts`; persistence lives in `db/` and `client.ts`.
 */

export const MORROW_COLORS = ['white', 'grey', 'black'] as const;
export type MorrowColor = (typeof MORROW_COLORS)[number];

/**
 * A screen that shows the Glance in a browser: a wall TV, a tablet, a kiosk.
 * Width and height are the reference size the layout is designed against;
 * the Player adapts to the real viewport. Presets live in `lib/morrow/screens`.
 */
export interface ScreenProfile {
  id: string;
  name: string;
  width: number;
  height: number;
  /** How often the Player checks Morrow Server for configuration changes. */
  refreshSeconds: number;
}

export interface GlanceLayout {
  columns: number;
  rows: number;
}

/**
 * Where a block's data comes from. `poll`: Morrow Server fetches a public JSON
 * URL on an interval. `webhook`: an external system pushes JSON to
 * `POST /api/webhooks/<blockId>`. Blocks without a source render from settings.
 */
export type BlockDataSource =
  | { kind: 'poll'; url: string; intervalSeconds: number }
  | { kind: 'webhook' };

export const DATA_SOURCE_KINDS = ['poll', 'webhook'] as const;

/** The latest data held for a block, as delivered to its view. */
export interface BlockData {
  /** Parsed JSON from the source, or null when nothing has arrived yet. */
  data: unknown;
  fetchedAt: string | null;
  /** Last fetch or delivery problem, so a view can show it instead of stale numbers. */
  error: string | null;
}

/** One plugin view placed on a page grid. Positions are 1-based. */
export interface GlanceBlock {
  id: string;
  plugin: string;
  view: string;
  settings?: PluginSettings;
  data?: BlockDataSource;
  column: number;
  span: number;
  row: number;
  rowSpan: number;
}

export interface GlancePage {
  id: string;
  label: string;
  layout: GlanceLayout;
  blocks: GlanceBlock[];
}

/** The single shared configuration served to Admin and every Player. */
export interface MorrowConfig {
  name: string;
  location: string;
  timeZone: string;
  color: MorrowColor;
  /** Seconds each page stays on screen when the Player rotates pages. */
  rotationSeconds: number;
  defaultScreenId: string;
  screens: ScreenProfile[];
  pages: GlancePage[];
  /**
   * Installed plugins hidden from this install's Admin library. Every plugin
   * discovered in `plugins/` is available unless listed here, so a newly added
   * plugin appears without a config change. Existing blocks keep rendering.
   */
  disabledPlugins: string[];
}

export type PluginSettingValue = string | number | boolean;
export type PluginSettings = Record<string, PluginSettingValue>;

export const PLUGIN_SETTING_TYPES = ['text', 'textarea', 'timezone'] as const;
export type PluginSettingType = (typeof PLUGIN_SETTING_TYPES)[number];

export interface PluginSettingDefinition {
  id: string;
  label: string;
  type: PluginSettingType;
  placeholder?: string;
  defaultValue?: PluginSettingValue;
}

export interface PluginViewDefinition {
  id: string;
  name: string;
}

export interface PluginManifest {
  /** Stable, unique id such as `morrow.clock`. */
  id: string;
  name: string;
  version: string;
  description: string;
  /**
   * How often the plugin's content changes, in seconds. `0` means static.
   * Reserved for scheduling; the Player currently refreshes every minute.
   */
  refreshSeconds: number;
  views: PluginViewDefinition[];
  settings?: PluginSettingDefinition[];
  defaultSize: { span: number; rowSpan: number };
  /** Smallest size the view still reads well at. Defaults to 1×1. */
  minSize?: { span: number; rowSpan: number };
  /** True when views read `data`; Admin then offers poll and webhook sources. */
  acceptsData?: boolean;
}

/** Props every plugin view receives. */
export interface PluginViewProps {
  now: Date;
  settings: PluginSettings;
  /** Present when the block has a data source and something has been stored. */
  data?: BlockData;
}

export type PluginIcon = ComponentType<{ className?: string }>;

export interface MorrowPlugin {
  manifest: PluginManifest;
  /** Optional icon shown in Admin. Any component accepting `className`. */
  icon?: PluginIcon;
  views: Record<string, ComponentType<PluginViewProps>>;
}

/** A registered plugin with render helpers used by Player and Admin. */
export interface PluginRuntime {
  manifest: PluginManifest;
  icon?: PluginIcon;
  hasView: (view: string) => boolean;
  render: (view: string, props: PluginViewProps) => ReactNode;
}

export function definePlugin<const TPlugin extends MorrowPlugin>(
  plugin: TPlugin,
): TPlugin {
  return plugin;
}
