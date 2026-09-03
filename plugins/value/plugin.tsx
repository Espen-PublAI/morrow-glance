import { Hash } from 'lucide-react';

import { readStringSetting } from '@/lib/morrow/settings';
import { formatValue, readPath } from '@/lib/morrow/sources';
import { definePlugin, type PluginViewProps } from '@/lib/morrow/types';

import './plugin.css';

/**
 * Show one value from a block's data: a temperature, a count, a status word.
 * The data comes from the block's poll or webhook source; `path` picks the
 * field, for example `main.temp` or `items[0].name`.
 */
function BigValueView({ settings, data }: PluginViewProps) {
  const label = readStringSetting(settings, 'label');
  const path = readStringSetting(settings, 'path');
  const unit = readStringSetting(settings, 'unit');
  const value = data ? readPath(data.data, path) : undefined;
  const text = formatValue(value);
  const waiting = !data || data.fetchedAt === null;

  return (
    <div className="plugin-view value-plugin">
      {label && <span className="plugin-label">{label}</span>}
      {waiting ? (
        <span className="value-plugin-state">Waiting for data</span>
      ) : text === '' ? (
        <span className="value-plugin-state">No value at {path || 'root'}</span>
      ) : (
        <strong>
          {text}
          {unit && <small>{unit}</small>}
        </strong>
      )}
      {data?.error && <span className="value-plugin-error">{data.error}</span>}
    </div>
  );
}

export const plugin = definePlugin({
  manifest: {
    id: 'morrow.value',
    name: 'Value',
    version: '0.1.0',
    description: 'One number or word from a polled URL or a webhook.',
    refreshSeconds: 60,
    views: [{ id: 'big', name: 'Big value' }],
    settings: [
      {
        id: 'label',
        label: 'Label',
        type: 'text',
        placeholder: 'Optional label',
      },
      { id: 'path', label: 'Field', type: 'text', placeholder: 'main.temp' },
      { id: 'unit', label: 'Unit', type: 'text', placeholder: '°C' },
    ],
    defaultSize: { span: 4, rowSpan: 2 },
    minSize: { span: 2, rowSpan: 1 },
    acceptsData: true,
  },
  icon: Hash,
  views: { big: BigValueView },
});
