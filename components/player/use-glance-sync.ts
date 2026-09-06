'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';

import {
  MORROW_CONFIG_EVENT,
  cacheMorrowConfig,
  fetchBlockData,
  fetchRemoteMorrowConfig,
  readStoredMorrowConfig,
  reloadAllowed,
} from '@/lib/morrow/client';
import { resolveScreen } from '@/lib/morrow/screens';
import type {
  BlockData,
  MorrowConfig,
  ScreenProfile,
} from '@/lib/morrow/types';

/**
 * Everything the Player learns from Morrow Server: the shared configuration,
 * the latest block data, and the screen whose refresh interval it follows.
 *
 * A screen runs unattended for weeks, so the rules here are about not
 * disturbing what is already on the wall: a poll that brings nothing new must
 * not repaint, an unreachable server must not blank the display, and a deploy
 * must be picked up without anyone visiting the room.
 */

const subscribeNever = () => () => {};
const readRequestedScreen = () =>
  new URLSearchParams(window.location.search).get('screen');
const noScreen = () => null;

export interface GlanceSync {
  config: MorrowConfig;
  /** Latest data per block id, for blocks with a data source. */
  blockData: Record<string, BlockData>;
  /** The screen this Player follows, from `?screen=<id>` or the default. */
  screen: ScreenProfile;
}

export function useGlanceSync(initialConfig: MorrowConfig): GlanceSync {
  const [config, setConfig] = useState<MorrowConfig>(initialConfig);
  const [blockData, setBlockData] = useState<Record<string, BlockData>>({});
  // Poll bookkeeping lives in refs so re-running the effect never forgets it.
  const lastSerialized = useRef(JSON.stringify(initialConfig));
  const lastData = useRef('{}');
  const loadedOnce = useRef(false);

  // Hydration-safe: the server snapshot is null, the client reads the URL.
  const requestedScreenId = useSyncExternalStore(
    subscribeNever,
    readRequestedScreen,
    noScreen,
  );
  const screen = resolveScreen(config, requestedScreenId);
  const pollSeconds = screen.refreshSeconds;

  useEffect(() => {
    let cancelled = false;

    const applyData = (next: Record<string, BlockData>) => {
      // Re-rendering every plugin view on each poll when nothing changed is
      // waste, and /api/data always answers with a fresh object, so compare
      // the content rather than the reference.
      const serialized = JSON.stringify(next);
      if (serialized === lastData.current) return;
      lastData.current = serialized;
      setBlockData(next);
    };

    const apply = (next: MorrowConfig) => {
      // Always keep the local copy fresh, even when nothing changed on screen:
      // this screen may never have written one, or may hold an older one.
      cacheMorrowConfig(next);
      const serialized = JSON.stringify(next);
      if (serialized === lastSerialized.current) return;
      lastSerialized.current = serialized;
      setConfig(next);
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

  return { config, blockData, screen };
}

/**
 * The current time, ticking once per minute on the minute boundary. Null until
 * the browser has it, so the server and the first client render agree.
 */
export function useMinuteClock(): Date | null {
  const [now, setNow] = useState<Date | null>(null);

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

  return now;
}
