import { Type } from 'lucide-react';

import { readStringSetting } from '@/lib/morrow/settings';
import { definePlugin, type PluginViewProps } from '@/lib/morrow/types';

import './plugin.css';

function NoteView({ settings }: PluginViewProps) {
  const label = readStringSetting(settings, 'label');
  const text = readStringSetting(settings, 'text');

  return (
    <div className="plugin-view text-plugin">
      {label && <span className="plugin-label">{label}</span>}
      {text && <p>{text}</p>}
    </div>
  );
}

export const plugin = definePlugin({
  manifest: {
    id: 'morrow.text',
    name: 'Text',
    version: '0.1.0',
    description: 'Add a note, welcome message, or announcement.',
    refreshSeconds: 0,
    views: [{ id: 'note', name: 'Note' }],
    settings: [
      {
        id: 'label',
        label: 'Label',
        type: 'text',
        placeholder: 'Optional label',
      },
      {
        id: 'text',
        label: 'Text',
        type: 'textarea',
        placeholder: 'Write something for the screen',
      },
    ],
    defaultSize: { span: 8, rowSpan: 2 },
    minSize: { span: 3, rowSpan: 1 },
  },
  icon: Type,
  views: { note: NoteView },
});
