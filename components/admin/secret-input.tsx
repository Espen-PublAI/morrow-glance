'use client';

import { Check, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';

import {
  deleteSecret,
  readSecretNames,
  readStoredAdminToken,
  writeSecret,
} from '@/lib/morrow/client';

/**
 * A setting that is stored on the server for this block and never returned.
 * Saved immediately through the secrets API, independent of the config Save,
 * so the value is never part of the configuration in the browser or on disk.
 */
export function SecretInput({
  id,
  blockId,
  name,
  placeholder,
}: {
  id: string;
  blockId: string;
  name: string;
  placeholder?: string;
}) {
  const [isSet, setIsSet] = useState<boolean | null>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    let cancelled = false;
    readSecretNames(blockId, readStoredAdminToken())
      .then((names) => {
        if (!cancelled) setIsSet(names.includes(name));
      })
      .catch(() => {
        if (!cancelled) setIsSet(false);
      });
    return () => {
      cancelled = true;
    };
  }, [blockId, name]);

  const save = async () => {
    if (!draft.trim()) return;
    setBusy(true);
    setMessage('');
    try {
      const names = await writeSecret(
        blockId,
        name,
        draft.trim(),
        readStoredAdminToken(),
      );
      setIsSet(names.includes(name));
      setDraft('');
      setMessage('Saved on the server. It takes effect on the next fetch.');
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : 'Could not save.');
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    setMessage('');
    try {
      const names = await deleteSecret(blockId, name, readStoredAdminToken());
      setIsSet(names.includes(name));
      setMessage('Removed.');
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : 'Could not remove.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="secret-input">
      <div className="secret-row">
        <input
          id={id}
          data-lpignore="true"
          type="password"
          autoComplete="off"
          value={draft}
          placeholder={
            isSet
              ? 'Set · paste a new value to replace'
              : (placeholder ?? 'Paste value')
          }
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              void save();
            }
          }}
        />
        <button
          type="button"
          className="secret-action"
          disabled={busy || !draft.trim()}
          onClick={() => void save()}
        >
          <Check /> Save
        </button>
        {isSet && (
          <button
            type="button"
            className="secret-action is-remove"
            disabled={busy}
            onClick={() => void remove()}
            aria-label="Remove"
          >
            <Trash2 />
          </button>
        )}
      </div>
      <p
        className={
          draft.trim() && !busy ? 'field-note is-warning' : 'field-note'
        }
      >
        {draft.trim() && !busy
          ? 'Not stored yet. Press Save beside this field; the Save button at the top of Admin does not include it.'
          : message ||
            (isSet === null
              ? 'Checking…'
              : isSet
                ? 'Stored on Morrow Server for this block only; never shown again and never part of the configuration.'
                : 'Not set. Stored on Morrow Server for this block only, outside the configuration.')}
      </p>
    </div>
  );
}
