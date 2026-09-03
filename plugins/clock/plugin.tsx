import { Clock3 } from 'lucide-react';

import { formatTime, humanizeTimeZone } from '@/lib/morrow/format';
import { readStringSetting } from '@/lib/morrow/settings';
import { definePlugin, type PluginViewProps } from '@/lib/morrow/types';

import './plugin.css';

function DigitalView({ now, settings }: PluginViewProps) {
  const label = readStringSetting(settings, 'label');
  const timeZone = readStringSetting(settings, 'timeZone');

  return (
    <div className="plugin-view clock-plugin">
      {label && <span className="plugin-label">{label}</span>}
      <time>{formatTime(now, timeZone)}</time>
      {timeZone && <small>{humanizeTimeZone(timeZone)}</small>}
    </div>
  );
}

export const plugin = definePlugin({
  manifest: {
    id: 'morrow.clock',
    name: 'Clock',
    version: '0.1.0',
    description: 'Show the current time in any timezone.',
    refreshSeconds: 60,
    views: [{ id: 'digital', name: 'Digital' }],
    settings: [
      {
        id: 'label',
        label: 'Label',
        type: 'text',
        placeholder: 'Optional label',
      },
      {
        id: 'timeZone',
        label: 'Timezone',
        type: 'timezone',
        placeholder: 'Europe/Oslo',
      },
    ],
    defaultSize: { span: 4, rowSpan: 2 },
    minSize: { span: 2, rowSpan: 1 },
  },
  icon: Clock3,
  views: { digital: DigitalView },
});
