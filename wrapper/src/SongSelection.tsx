import { useEffect, useState } from 'react';
import type { Library, Tag } from '../../shared/types';
import { api } from './api';
import { TagPicker, useAction } from './Editors';
import { Modal } from './Modal';
import { useTranslation } from './Preferences';

export function SongSelection({
  songIds,
  library,
  tag,
  onClear,
  onChanged,
  onDeleted,
}: {
  songIds: number[];
  library: Library;
  tag?: Tag;
  onClear(): void;
  onChanged(): void;
  onDeleted(ids: number[]): void;
}) {
  const { t } = useTranslation();
  const { busy, error, run } = useAction();
  const [editing, setEditing] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [removeTag, setRemoveTag] = useState('');

  useEffect(() => {
    const keyDown = (event: KeyboardEvent) => {
      if (
        !['Backspace', 'Delete'].includes(event.key) ||
        event.defaultPrevented ||
        event.repeat ||
        event.isComposing ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        event.shiftKey ||
        busy ||
        document.querySelector('dialog[open]') ||
        !(event.target instanceof HTMLElement) ||
        event.target.closest(
          'textarea, select, [contenteditable]:not([contenteditable="false"])',
        ) ||
        (event.target instanceof HTMLInputElement &&
          event.target.type !== 'checkbox')
      )
        return;
      event.preventDefault();
      setRemoving(true);
    };
    document.addEventListener('keydown', keyDown);
    return () => document.removeEventListener('keydown', keyDown);
  }, [busy]);

  const edit = (action: 'add-tag' | 'remove-tag' | 'delete', tagId?: number) =>
    run(async () => {
      await api('/songs/batch', 'POST', { songIds, action, tagId });
      if (action === 'delete') onDeleted(songIds);
      onChanged();
      onClear();
    });
  const explanation = t(
    'Removal excludes these songs from the tag, including inherited and artist membership. Other songs and artist credits stay unchanged. Add the tag again to restore membership.',
  );

  return (
    <div className="song-selection">
      <strong role="status">{t('{0} selected', songIds.length)}</strong>
      <button onClick={() => setEditing(true)} disabled={busy}>
        {t('Edit tags')}
      </button>
      <button onClick={() => setRemoving(true)} disabled={busy}>
        {tag ? t('Remove current tag') : t('Remove from library')}
      </button>
      <button onClick={onClear} disabled={busy}>
        {t('Clear selection')}
      </button>
      {error && !editing && !removing && (
        <p className="notice error" role="alert">
          {t(error)}
        </p>
      )}
      {(editing || removing) && (
        <Modal
          title={
            removing
              ? tag
                ? t('Remove current tag')
                : t('Remove from library')
              : t('Edit tags')
          }
          onClose={() => {
            if (!busy) {
              setEditing(false);
              setRemoving(false);
            }
          }}
        >
          <p>{t('{0} selected', songIds.length)}</p>
          {removing ? (
            <>
              <p>
                {tag
                  ? t('Remove “{0}” from the selected songs?', tag.name)
                  : t(
                      'Permanently delete the selected songs and their assignments from this library? Empty artist tags will also be removed.',
                    )}
              </p>
              {tag && <p className="field-note">{explanation}</p>}
              <div className="button-row">
                <button
                  className="danger"
                  disabled={busy}
                  onClick={() =>
                    void edit(tag ? 'remove-tag' : 'delete', tag?.id)
                  }
                >
                  {t('Confirm removal')}
                </button>
                <button disabled={busy} onClick={() => setRemoving(false)}>
                  {t('Cancel')}
                </button>
              </div>
            </>
          ) : (
            <>
              <TagPicker
                label={t('Tag to assign')}
                tags={library.tags}
                available={library.tags}
                busy={busy}
                run={run}
                onAssign={async (tagId) => {
                  await api('/songs/batch', 'POST', {
                    songIds,
                    action: 'add-tag',
                    tagId,
                  });
                  onChanged();
                  onClear();
                }}
              />
              <form
                className="inline-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (removeTag) void edit('remove-tag', Number(removeTag));
                }}
              >
                <select
                  aria-label={t('Tag to remove')}
                  value={removeTag}
                  disabled={busy}
                  onChange={(event) => setRemoveTag(event.target.value)}
                >
                  <option value="">{t('Choose a tag')}</option>
                  {library.tags.map((tag) => (
                    <option key={tag.id} value={tag.id}>
                      {tag.name}
                    </option>
                  ))}
                </select>
                <button disabled={busy || !removeTag}>{t('Remove tag')}</button>
              </form>
              <p className="field-note">{explanation}</p>
            </>
          )}
          {error && (
            <p className="notice error" role="alert">
              {t(error)}
            </p>
          )}
        </Modal>
      )}
    </div>
  );
}
