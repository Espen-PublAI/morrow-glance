import { Sparkles } from 'lucide-react';

import { readStringSetting } from '@/lib/morrow/settings';
import { definePlugin, type PluginViewProps } from '@/lib/morrow/types';

import './plugin.css';

/**
 * Starter plugin. Copy this folder to `plugins/<your-name>/`, change the id,
 * and it appears in Admin on the next dev-server start. Folders starting with
 * an underscore are ignored by discovery.
 */
function DefaultView({ now, settings }: PluginViewProps) {
  // Set `acceptsData: true` in the manifest and read `data` here to show live
  // values from a poll or webhook source. See plugins/value for an example.
  const label = readStringSetting(settings, 'label');

  return (
    <div className="plugin-view example-plugin">
      {label && <span className="plugin-label">{label}</span>}
      <strong>{now.toLocaleTimeString()}</strong>
    </div>
  );
}

export const plugin = definePlugin({
  manifest: {
    id: 'example.plugin', // Unique, URL-safe. Use a namespace: `yourname.thing`.
    name: 'Example',
    version: '0.1.0',
    description: 'One sentence shown in the plugin library.',
    refreshSeconds: 0,
    views: [{ id: 'default', name: 'Default' }],
    settings: [
      {
        id: 'label',
        label: 'Label',
        type: 'text',
        placeholder: 'Optional label',
      },
    ],
    defaultSize: { span: 4, rowSpan: 2 },
    minSize: { span: 2, rowSpan: 1 },
  },
  icon: Sparkles,
  views: { default: DefaultView },
});
