import { LayoutGrid } from 'lucide-react';

import type { PluginRuntime } from '@/lib/morrow/types';

export function PluginIcon({ plugin }: { plugin: PluginRuntime | undefined }) {
  const Icon = plugin?.icon ?? LayoutGrid;
  return <Icon aria-hidden="true" />;
}
