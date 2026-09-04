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
  fetch: fetchGitHub,
});
