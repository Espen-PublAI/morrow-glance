import { definePluginServer } from '@/lib/morrow/types';

import { fetchGitHub } from './github';

/**
 * Server half of the GitHub plugin. The token, when there is one, comes from
 * the block's secret or from `MORROW_GITHUB_TOKEN`, and never leaves Morrow
 * Server. Five minutes is frequent enough for a wall and well inside the
 * 5,000 requests an hour a token allows.
 */
export const server = definePluginServer({
  intervalSeconds: 300,
  // The four repository views want the same fetch, and the two person views
  // want the same one as each other, so blocks of either kind share a call.
  dataKey: (_settings, view) =>
    view === 'heatmap' || view === 'activity' ? 'person' : 'repository',
  fetch: fetchGitHub,
});
