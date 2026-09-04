'use client';

import { ChevronLeft, ChevronRight, Pause, Play } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';

import { GlanceRenderer } from '@/components/glance-renderer';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  MORROW_CONFIG_EVENT,
  cacheMorrowConfig,
  fetchBlockData,
  fetchRemoteMorrowConfig,
  readStoredMorrowConfig,
  reloadAllowed,
} from '@/lib/morrow/client';
import { formatDate, formatTime } from '@/lib/morrow/format';
import { resolveScreen } from '@/lib/morrow/screens';
import type { BlockData, MorrowConfig } from '@/lib/morrow/types';

/** Minimum horizontal swipe, in pixels, that counts as a page change. */
const SWIPE_THRESHOLD = 52;

const subscribeNever = () => () => {};
const readRequestedScreen = () =>
  new URLSearchParams(window.location.search).get('screen');
const noScreen = () => null;

interface MorrowDisplayProps {
  /** Server-rendered configuration, so the first paint is already correct. */
  initialConfig: MorrowConfig;
}

/**
 * Morrow Player: presents the Glance in a browser, polls Morrow Server for
 * configuration changes, and rotates pages when there is more than one.
 * `/?screen=<id>` makes it follow a specific screen's refresh interval.
 */
export function MorrowDisplay({ initialConfig }: MorrowDisplayProps) {
  const [config, setConfig] = useState<MorrowConfig>(initialConfig);
  const [pageId, setPageId] = useState<string>(
    initialConfig.pages[0]?.id ?? '',
  );
  const [playing, setPlaying] = useState(initialConfig.pages.length > 1);
  const [now, setNow] = useState<Date | null>(null);
  const [blockData, setBlockData] = useState<Record<string, BlockData>>({});
  const [rotationKey, setRotationKey] = useState(0);
  const touchStart = useRef<number | null>(null);
  const pagesRef = useRef(config.pages);
  // Poll bookkeeping lives in refs so re-running the effect never forgets it.
  const lastSerialized = useRef(JSON.stringify(initialConfig));
  const lastData = useRef('{}');
  const loadedOnce = useRef(false);

  const pages = config.pages;
  const firstPageId = pages[0]?.id ?? '';
  const activePage = pages.some((item) => item.id === pageId)
    ? pageId
    : firstPageId;
  const hasMultiplePages = pages.length > 1;
  const pageIndex = pages.findIndex((item) => item.id === activePage);
  // Hydration-safe: the server snapshot is null, the client reads the URL.
  const requestedScreenId = useSyncExternalStore(
    subscribeNever,
    readRequestedScreen,
    noScreen,
  );
  const screen = resolveScreen(config, requestedScreenId);
  const pollSeconds = screen.refreshSeconds;

  useEffect(() => {
    pagesRef.current = pages;
  }, [pages]);

  // Stable across config polls so the rotation timer is not restarted by them.
  const move = useCallback((direction: 1 | -1) => {
    setPageId((current) => {
      const list = pagesRef.current;
      if (list.length === 0) return current;
      const index = Math.max(
        0,
        list.findIndex((item) => item.id === current),
      );
      const next = list[(index + direction + list.length) % list.length];
      return next?.id ?? current;
    });
    setRotationKey((key) => key + 1);
  }, []);

  const selectPage = useCallback((id: string) => {
    setPageId(id);
    setRotationKey((key) => key + 1);
  }, []);

  // Poll the configuration. Only apply it when it actually changed so unrelated
  // state (pause, rotation progress) is left alone.
  useEffect(() => {
    let cancelled = false;

    const applyData = (next: Record<string, BlockData>) => {
      // A screen runs for weeks. Re-rendering every plugin view on each poll
      // when nothing changed is waste, and /api/data always answers with a
      // fresh object, so compare the content rather than the reference.
      const serialized = JSON.stringify(next);
      if (serialized === lastData.current) return;
      lastData.current = serialized;
      setBlockData(next);
    };

    const apply = (next: MorrowConfig) => {
      // Always keep the local copy fresh, even when nothing changed on screen.
      cacheMorrowConfig(next);
      const serialized = JSON.stringify(next);
      if (serialized === lastSerialized.current) return;
      const wasMultiple =
        (JSON.parse(lastSerialized.current) as MorrowConfig).pages.length > 1;
      lastSerialized.current = serialized;
      setConfig(next);
      if (!wasMultiple && next.pages.length > 1) setPlaying(true);
    };

    const sync = async () => {
      try {
        const [{ config: remote, staleClient }, data] = await Promise.all([
          fetchRemoteMorrowConfig(),
          // Block data is best effort: a failing source must not hide the config.
          fetchBlockData().catch(() => null),
        ]);
        if (cancelled) return;
        loadedOnce.current = true;
        // A wall screen can stay open for weeks; pick up new assets after a deploy.
        if (staleClient && reloadAllowed()) {
          window.location.reload();
          return;
        }
        apply(remote);
        if (data) applyData(data);
      } catch {
        // Server unreachable: keep what we have, or the last copy this screen saw.
        if (!cancelled && !loadedOnce.current) apply(readStoredMorrowConfig());
      }
    };

    const requestSync = () => {
      void sync();
    };
    const frame = window.requestAnimationFrame(requestSync);
    const interval = window.setInterval(requestSync, pollSeconds * 1000);
    window.addEventListener('storage', requestSync);
    window.addEventListener(MORROW_CONFIG_EVENT, requestSync);
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(frame);
      window.clearInterval(interval);
      window.removeEventListener('storage', requestSync);
      window.removeEventListener(MORROW_CONFIG_EVENT, requestSync);
    };
  }, [pollSeconds]);

  // Tick once per minute, aligned to the minute boundary.
  useEffect(() => {
    let clock: number | undefined;
    const frame = window.requestAnimationFrame(() => setNow(new Date()));
    const untilNextMinute = 60_000 - (Date.now() % 60_000);
    const alignment = window.setTimeout(() => {
      setNow(new Date());
      clock = window.setInterval(() => setNow(new Date()), 60_000);
    }, untilNextMinute);

    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(alignment);
      if (clock) window.clearInterval(clock);
    };
  }, []);

  useEffect(() => {
    if (!playing || !hasMultiplePages) return;
    const rotation = window.setTimeout(
      () => move(1),
      config.rotationSeconds * 1000,
    );
    return () => window.clearTimeout(rotation);
  }, [config.rotationSeconds, hasMultiplePages, move, playing, rotationKey]);

  useEffect(() => {
    if (!hasMultiplePages) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'ArrowRight') move(1);
      if (event.key === 'ArrowLeft') move(-1);
      if (event.key === ' ') {
        event.preventDefault();
        setPlaying((value) => !value);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [hasMultiplePages, move]);

  const time = now ? formatTime(now, config.timeZone) : '';
  const date = now ? formatDate(now, config.timeZone) : '';

  return (
    <main
      className="morrow-display"
      data-color={config.color}
      data-screen={screen.id}
      onTouchStart={(event) => {
        touchStart.current = event.touches[0]?.clientX ?? null;
      }}
      onTouchEnd={(event) => {
        const start = touchStart.current;
        const end = event.changedTouches[0]?.clientX;
        touchStart.current = null;
        if (start === null || end === undefined || !hasMultiplePages) return;
        const delta = end - start;
        if (Math.abs(delta) > SWIPE_THRESHOLD) move(delta < 0 ? 1 : -1);
      }}
    >
      <Tabs
        value={activePage}
        onValueChange={(value) => selectPage(String(value))}
        className="display-tabs"
      >
        <div className="page-stage">
          {pages.map((item) => (
            <TabsContent key={item.id} value={item.id}>
              {now && (
                <GlanceRenderer
                  page={item}
                  now={now}
                  blockData={blockData}
                  timeZone={config.timeZone}
                />
              )}
            </TabsContent>
          ))}
        </div>

        <footer className="paper-footer">
          <div className="rotation-track" aria-hidden="true">
            {playing && hasMultiplePages && (
              <span
                key={`${activePage}-${rotationKey}`}
                style={{ animationDuration: `${config.rotationSeconds}s` }}
              />
            )}
          </div>
          <div className="footer-group">
            <span className="footer-tag">
              <span className="footer-mark" aria-hidden="true" />
              {config.name}
            </span>
            {config.footer.date && date && (
              <span className="footer-tag is-quiet is-date">{date}</span>
            )}
          </div>
          <div className="footer-center">
            {hasMultiplePages && (
              <>
                <TabsList
                  variant="line"
                  aria-label="Glance pages"
                  className="tab-list"
                >
                  {pages.map((item) => (
                    <TabsTrigger key={item.id} value={item.id}>
                      {item.label}
                    </TabsTrigger>
                  ))}
                </TabsList>
                <div className="player-controls">
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => move(-1)}
                    aria-label="Previous page"
                  >
                    <ChevronLeft />
                  </Button>
                  <span>
                    {pageIndex + 1}/{pages.length}
                  </span>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setPlaying((value) => !value)}
                    aria-label={playing ? 'Pause rotation' : 'Resume rotation'}
                  >
                    {playing ? <Pause /> : <Play />}
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => move(1)}
                    aria-label="Next page"
                  >
                    <ChevronRight />
                  </Button>
                </div>
              </>
            )}
          </div>
          <div className="footer-group is-end">
            {config.footer.location && config.location && (
              <span className="footer-tag is-quiet">{config.location}</span>
            )}
            {config.footer.time && (
              <span className="footer-tag">
                <time>{time}</time>
              </span>
            )}
          </div>
        </footer>
      </Tabs>
    </main>
  );
}
