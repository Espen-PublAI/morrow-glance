'use client';

import { useSyncExternalStore } from 'react';

import { AdminConsole } from '@/components/admin/admin-console';
import type { MorrowConfig } from '@/lib/morrow/types';

const subscribeNever = () => () => {};
const onClient = () => true;
const onServer = () => false;

/**
 * Render Admin on the client only. Password managers (LastPass in particular)
 * inject their own elements into text fields before React hydrates, which
 * breaks hydration of a server-rendered form. Admin gains nothing from SSR, so
 * the server sends an empty shell and the console mounts once the page is live.
 */
export function AdminMount(props: {
  initialConfig: MorrowConfig;
  initialUpdatedAt: string | null;
}) {
  const mounted = useSyncExternalStore(subscribeNever, onClient, onServer);
  if (!mounted) {
    return (
      <main
        className="admin-shell"
        aria-busy="true"
        aria-label="Loading Admin"
      />
    );
  }
  return <AdminConsole {...props} />;
}
