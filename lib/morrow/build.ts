/**
 * Identifies the running server build so long-lived Players can notice a
 * deploy and reload themselves.
 *
 * Set `MORROW_BUILD_ID` at deploy time (a git SHA works well). Without it,
 * development uses an id minted when the server starts, so restarting the dev
 * server refreshes open Players. Production without the variable reports
 * `unknown`, and Players then never self-reload.
 */
const startupId = Date.now().toString(36);

export function serverBuildId(): string {
  const explicit = process.env.MORROW_BUILD_ID?.trim();
  if (explicit) return explicit;
  return process.env.NODE_ENV === 'production' ? 'unknown' : `dev-${startupId}`;
}

export const BUILD_HEADER = 'x-morrow-build';

/** Polls in a row a new build id must be seen before a Player reloads. */
export const BUILD_CONFIRMATIONS = 2;

/**
 * Decides when a build id observed from the server means the client is stale.
 *
 * During a gradual rollout two builds answer at once, so a single differing
 * id is not enough: the same new id has to show up on consecutive polls.
 * Pure and instance-based so it can be tested without a browser.
 */
export function createBuildTracker(confirmations = BUILD_CONFIRMATIONS) {
  let baseline: string | null = null;
  let candidate: string | null = null;
  let seen = 0;

  return {
    /** Feed the id from a response; true means "reload now". */
    observe(build: string | null): boolean {
      if (!build || build === 'unknown') return false;
      if (baseline === null) {
        baseline = build;
        return false;
      }
      if (build === baseline) {
        candidate = null;
        seen = 0;
        return false;
      }
      if (build === candidate) {
        seen += 1;
      } else {
        candidate = build;
        seen = 1;
      }
      return seen >= confirmations;
    },
  };
}
