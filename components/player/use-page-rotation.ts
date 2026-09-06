'use client';

import type { TouchEvent } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';

import type { GlancePage } from '@/lib/morrow/types';

/**
 * Which page is on screen, and how it changes: on a timer, with the arrow
 * keys, from the controls, or by swiping. Kept apart from polling so that a
 * configuration arriving from the server never resets where someone is.
 */

/** Minimum horizontal swipe, in pixels, that counts as a page change. */
const SWIPE_THRESHOLD = 52;

export interface PageRotation {
  activePageId: string;
  pageIndex: number;
  hasMultiplePages: boolean;
  playing: boolean;
  togglePlaying: () => void;
  /** Advance forward (1) or back (-1), wrapping at the ends. */
  move: (direction: 1 | -1) => void;
  selectPage: (id: string) => void;
  /**
   * Changes whenever the page changes, including a re-selection of the same
   * page. The progress bar keys off it so its animation restarts.
   */
  rotationKey: number;
  swipeHandlers: {
    onTouchStart: (event: TouchEvent<HTMLElement>) => void;
    onTouchEnd: (event: TouchEvent<HTMLElement>) => void;
  };
}

export function usePageRotation(
  pages: GlancePage[],
  rotationSeconds: number,
): PageRotation {
  const [pageId, setPageId] = useState<string>(pages[0]?.id ?? '');
  const [playing, setPlaying] = useState(pages.length > 1);
  const [rotatable, setRotatable] = useState(pages.length > 1);
  const [rotationKey, setRotationKey] = useState(0);
  const touchStart = useRef<number | null>(null);
  const pagesRef = useRef(pages);

  const firstPageId = pages[0]?.id ?? '';
  const activePageId = pages.some((item) => item.id === pageId)
    ? pageId
    : firstPageId;
  const hasMultiplePages = pages.length > 1;
  const pageIndex = pages.findIndex((item) => item.id === activePageId);

  useEffect(() => {
    pagesRef.current = pages;
  }, [pages]);

  // A second page appearing is a reason to start rotating; nothing else is, so
  // a poll that changes an unrelated setting leaves a paused screen paused.
  // Adjusted during render rather than in an effect, so the first paint after
  // the new page arrives already shows the rotation running.
  if (hasMultiplePages !== rotatable) {
    setRotatable(hasMultiplePages);
    if (hasMultiplePages) setPlaying(true);
  }

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

  const togglePlaying = useCallback(() => setPlaying((value) => !value), []);

  useEffect(() => {
    if (!playing || !hasMultiplePages) return;
    const rotation = window.setTimeout(() => move(1), rotationSeconds * 1000);
    return () => window.clearTimeout(rotation);
  }, [hasMultiplePages, move, playing, rotationKey, rotationSeconds]);

  useEffect(() => {
    if (!hasMultiplePages) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'ArrowRight') move(1);
      if (event.key === 'ArrowLeft') move(-1);
      if (event.key === ' ') {
        event.preventDefault();
        togglePlaying();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [hasMultiplePages, move, togglePlaying]);

  return {
    activePageId,
    pageIndex,
    hasMultiplePages,
    playing,
    togglePlaying,
    move,
    selectPage,
    rotationKey,
    swipeHandlers: {
      onTouchStart: (event) => {
        touchStart.current = event.touches[0]?.clientX ?? null;
      },
      onTouchEnd: (event) => {
        const start = touchStart.current;
        const end = event.changedTouches[0]?.clientX;
        touchStart.current = null;
        if (start === null || end === undefined || !hasMultiplePages) return;
        const delta = end - start;
        if (Math.abs(delta) > SWIPE_THRESHOLD) move(delta < 0 ? 1 : -1);
      },
    },
  };
}
