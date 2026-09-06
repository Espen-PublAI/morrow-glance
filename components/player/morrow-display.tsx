'use client';

import { ChevronLeft, ChevronRight, Pause, Play } from 'lucide-react';

import { GlanceRenderer } from '@/components/player/glance-renderer';
import {
  useGlanceSync,
  useMinuteClock,
} from '@/components/player/use-glance-sync';
import { usePageRotation } from '@/components/player/use-page-rotation';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { formatDate, formatTime } from '@/lib/morrow/format';
import type { MorrowConfig } from '@/lib/morrow/types';

interface MorrowDisplayProps {
  /** Server-rendered configuration, so the first paint is already correct. */
  initialConfig: MorrowConfig;
}

/**
 * Morrow Player: presents the Glance in a browser and keeps it current.
 *
 * This file is layout only. What it knows lives in `useGlanceSync`, and where
 * it is lives in `usePageRotation`, which is where both are tested.
 */
export function MorrowDisplay({ initialConfig }: MorrowDisplayProps) {
  const { config, blockData, screen } = useGlanceSync(initialConfig);
  const now = useMinuteClock();
  const pages = config.pages;
  const {
    activePageId,
    pageIndex,
    hasMultiplePages,
    playing,
    togglePlaying,
    move,
    selectPage,
    rotationKey,
    swipeHandlers,
  } = usePageRotation(pages, config.rotationSeconds);

  const time = now
    ? formatTime(now, config.timeZone, config.hourFormat, config.locale)
    : '';
  const date = now ? formatDate(now, config.timeZone, config.locale) : '';

  return (
    <main
      className="morrow-display"
      data-color={config.color}
      data-screen={screen.id}
      {...swipeHandlers}
    >
      <Tabs
        value={activePageId}
        onValueChange={(value) => selectPage(String(value))}
        className="display-tabs"
      >
        <div className="page-stage">
          {pages.map((item) => (
            <TabsContent key={item.id} value={item.id}>
              {now && (
                <GlanceRenderer
                  page={item}
                  blockData={blockData}
                  display={{
                    now,
                    timeZone: config.timeZone,
                    hourFormat: config.hourFormat,
                    locale: config.locale,
                  }}
                />
              )}
            </TabsContent>
          ))}
        </div>

        <footer className="paper-footer">
          <div className="rotation-track" aria-hidden="true">
            {playing && hasMultiplePages && (
              <span
                key={`${activePageId}-${rotationKey}`}
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
                    onClick={togglePlaying}
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
