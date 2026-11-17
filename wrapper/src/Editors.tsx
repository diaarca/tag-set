import { useTranslation } from './Preferences';
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import type { Library, SongDetails, Tag } from '../../shared/types.js';
import { api } from './api';
import { AppError } from '../../shared/errors.js';

function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError('');
    try {
      await action();
    } catch (error) {
      setError(
        error instanceof Error ? error.message : 'Something went wrong.',
      );
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, run };
}

function TagPicker({
  label,
  tags,
  available,
  busy,
  run,
  onAssign,
}: {
  label: string;
  tags: Tag[];
  available: Tag[];
  busy: boolean;
  run: ReturnType<typeof useAction>['run'];
  onAssign(id: number): Promise<void>;
}) {
  const { t } = useTranslation();
  const listId = useId();
  const list = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const name = query.trim();
  const normalized = name.toLowerCase();
  const existing = tags.find((tag) => tag.name.toLowerCase() === normalized);
  const matches = available
    .filter((tag) => tag.name.toLowerCase().includes(normalized))
    .sort(
      (a, b) =>
        Number(b.id === existing?.id) - Number(a.id === existing?.id) ||
        a.name.localeCompare(b.name),
    );
  const choices = matches.map((tag) => ({ id: tag.id, name: tag.name }));
  if (name && !existing) choices.push({ id: 0, name });
  const selected = Math.min(active, choices.length - 1);

  useEffect(() => {
    if (open)
      list.current
        ?.querySelector('[aria-selected="true"]')
        ?.scrollIntoView({ block: 'nearest' });
  }, [open, selected]);

  const assign = (index: number) => {
    const choice = choices[index];
    if (busy || !choice) return;
    void run(async () => {
      const id =
        choice.id ||
        (await api<{ id: number }>('/tags', 'POST', { name: choice.name })).id;
      await onAssign(id);
      setQuery('');
      setActive(-1);
      setOpen(false);
    });
  };
  return (
    <div
      className="tag-picker"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
    >
      <form
        className="inline-form"
        onSubmit={(event) => {
          event.preventDefault();
          assign(selected);
        }}
      >
        <input
          aria-label={label}
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={listId}
          aria-activedescendant={
            open && selected >= 0 ? `${listId}-${selected}` : undefined
          }
          autoComplete="off"
          placeholder={t('Search or create a tag…')}
          maxLength={200}
          value={query}
          disabled={busy}
          onFocus={() => setOpen(true)}
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(event.target.value.trim() ? 0 : -1);
            setOpen(true);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape' && open) {
              event.preventDefault();
              event.stopPropagation();
              setOpen(false);
            } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault();
              setOpen(true);
              setActive(
                Math.max(
                  0,
                  Math.min(
                    choices.length - 1,
                    selected + (event.key === 'ArrowDown' ? 1 : -1),
                  ),
                ),
              );
            } else if (event.key === 'Enter') {
              event.preventDefault();
              if (!event.nativeEvent.isComposing) assign(selected);
            }
          }}
        />
        <button disabled={busy || selected < 0}>
          {choices[selected]?.id === 0 ? t('Create & add') : t('Add tag')}
        </button>
      </form>
      {open && (
        <div
          id={listId}
          ref={list}
          role="listbox"
          aria-label={label}
          className="tag-picker-results"
        >
          {choices.map((choice, index) => (
            <button
              type="button"
              role="option"
              id={`${listId}-${index}`}
              key={choice.id}
              aria-selected={index === selected}
              tabIndex={-1}
              disabled={busy}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => assign(index)}
            >
              {choice.id ? choice.name : t('Create “{0}”', choice.name)}
            </button>
          ))}
          {!choices.length && (
            <p className="field-note">{t('No available tags match.')}</p>
          )}
        </div>
      )}
    </div>
  );
}

function DeleteButton({
  label,
  explanation,
  busy,
  onDelete,
}: {
  label: string;
  explanation: string;
  busy: boolean;
  onDelete(): void;
}) {
  const { t } = useTranslation();
  const [confirm, setConfirm] = useState(false);
  return (
    <div className="delete-area">
      {confirm ? (
        <>
          <p>{explanation}</p>
          <div className="button-row">
            <button
              type="button"
              disabled={busy}
              className="danger"
              onClick={onDelete}
            >
              {t('Confirm deletion')}
            </button>
            <button type="button" onClick={() => setConfirm(false)}>
              {t('Keep it')}
            </button>
          </div>
        </>
      ) : (
        <button
          type="button"
          className="text-button danger-text"
          onClick={() => setConfirm(true)}
        >
          {label}
        </button>
      )}
    </div>
  );
}

export function SongEditor({
  id,
  library,
  onChange,
  onCreated,
  onDeleted,
  onOpenTag,
}: {
  id?: number;
  library: Library;
  onChange(): void;
  onCreated(id: number): void;
  onDeleted(id: number): void;
  onOpenTag(id: number): void;
}) {
  const { t } = useTranslation();
  const [details, setDetails] = useState<SongDetails>();
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const [artists, setArtists] = useState('');
  const [loadError, setLoadError] = useState('');
  const [saved, setSaved] = useState(false);
  const { busy, error, run } = useAction();

  useEffect(() => {
    if (id === undefined) return;
    let cancelled = false;
    void api<SongDetails>(`/songs/${id}`)
      .then((song) => {
        if (cancelled) return;
        setDetails(song);
        setUrl(`https://music.youtube.com/watch?v=${song.videoId}`);
        setTitle(song.title);
        setArtists(song.artists.join('\n'));
      })
      .catch((error: Error) => {
        if (!cancelled) setLoadError(error.message);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  const refreshTags = async () => {
    if (id !== undefined) setDetails(await api<SongDetails>(`/songs/${id}`));
    onChange();
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    setSaved(false);
    void run(async () => {
      try {
        const song = await api<SongDetails>(
          id === undefined ? '/songs' : `/songs/${id}`,
          id === undefined ? 'POST' : 'PUT',
          {
            url,
            title,
            artists: artists
              .split('\n')
              .map((name) => name.trim())
              .filter(Boolean),
          },
        );
        onChange();
        if (id === undefined) onCreated(song.id);
        else {
          setDetails(song);
          setSaved(true);
        }
      } catch (error) {
        if (error instanceof AppError && error.songId) {
          onCreated(error.songId);
          return;
        }
        throw error;
      }
    });
  };
  const name = (tagId: number) =>
    library.tags.find((tag) => tag.id === tagId)?.name ?? 'Tag';
  const available = library.tags.filter(
    (tag) =>
      !details?.memberships.some(
        (member) => member.tagId === tag.id && member.manual,
      ),
  );

  if (loadError)
    return (
      <p role="alert" className="notice error">
        {t(loadError)}
      </p>
    );
  if (id !== undefined && !details)
    return <p className="muted">{t('Loading song…')}</p>;
  return (
    <>
      <p className="form-intro">
        {t(
          'A YouTube link, a title, and the artists behind it. Your library takes it from there.',
        )}
      </p>
      <form onSubmit={submit}>
        <fieldset disabled={busy}>
          <label>
            {t('YouTube / YouTube Music URL')}
            <input
              required
              type="url"
              maxLength={2048}
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder={t('https://music.youtube.com/watch?v=…')}
            />
          </label>
          <label>
            {t('Song title')}
            <input
              required
              maxLength={500}
              value={title}
              onChange={(event) => {
                setTitle(event.target.value);
                setSaved(false);
              }}
              placeholder={t('What’s this song called?')}
            />
          </label>
          <label>
            {t('Artists ')}
            <span className="field-hint">{t('one per line')}</span>
            <textarea
              required
              rows={2}
              value={artists}
              onChange={(event) => {
                setArtists(event.target.value);
                setSaved(false);
              }}
              placeholder={t('Daft Punk')}
            />
          </label>
          <p className="field-note">
            {t(
              'Each artist gets a tag automatically. Artist credits stay separate from tag names.',
            )}
          </p>
          <div className="button-row">
            <button className="primary" type="submit">
              {busy
                ? t('Saving…')
                : id === undefined
                  ? t('Add to library')
                  : t('Save song')}
            </button>
            {saved && (
              <span role="status" className="success-text">
                {t('Saved.')}
              </span>
            )}
          </div>
        </fieldset>
      </form>
      {error && (
        <div className="notice error" role="alert">
          {t(error)}
        </div>
      )}
      {details && (
        <section className="editor-section">
          <h3>{t('Tags on this song')}</h3>
          <p className="field-note">
            {t(
              'Remove direct assignments here. Inherited membership follows the linked tag relationships.',
            )}
          </p>
          <ul className="membership-list">
            {details.memberships.map((member) => (
              <li key={member.tagId}>
                <div>
                  <button
                    className="tag-link"
                    onClick={() => onOpenTag(member.tagId)}
                  >
                    # {name(member.tagId)}
                  </button>
                  <div className="membership-sources">
                    {member.artist && <span>{t('Artist tag')}</span>}
                    {member.manual && <span>{t('Added directly')}</span>}
                    {member.inheritedVia.map((child) => (
                      <span key={child}>
                        {t('Via')}{' '}
                        <button
                          className="text-button"
                          onClick={() => onOpenTag(child)}
                        >
                          {name(child)}
                        </button>
                      </span>
                    ))}
                  </div>
                </div>
                {member.manual && (
                  <button
                    className="icon-button"
                    disabled={busy}
                    aria-label={t('Remove direct {0} tag', name(member.tagId))}
                    onClick={() =>
                      void run(async () => {
                        await api(
                          `/songs/${id}/tags/${member.tagId}`,
                          'DELETE',
                        );
                        await refreshTags();
                      })
                    }
                  >
                    ×
                  </button>
                )}
              </li>
            ))}
          </ul>
          <TagPicker
            label={t('Tag to assign')}
            tags={library.tags}
            available={available}
            busy={busy}
            run={run}
            onAssign={async (tagId) => {
              await api(`/songs/${id}/tags/${tagId}`, 'PUT');
              await refreshTags();
            }}
          />
          <DeleteButton
            label={t('Delete song')}
            explanation={t(
              'Remove this song and its assignments from your library? Tags and the original YouTube video will remain.',
            )}
            busy={busy}
            onDelete={() =>
              void run(async () => {
                await api(`/songs/${id}`, 'DELETE');
                onDeleted(id!);
              })
            }
          />
        </section>
      )}
    </>
  );
}

export function TagEditor({
  tag,
  library,
  onChange,
  onCreated,
  onDeleted,
  onOpenTag,
}: {
  tag?: Tag;
  library: Library;
  onChange(): void;
  onCreated(id: number): void;
  onDeleted(): void;
  onOpenTag(id: number): void;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState(tag?.name ?? '');
  const [saved, setSaved] = useState(false);
  const { busy, error, run } = useAction();
  const parents = library.tags.filter((item) =>
    library.edges.some(
      (edge) => edge.parentId === item.id && edge.childId === tag?.id,
    ),
  );
  const children = library.tags.filter((item) =>
    library.edges.some(
      (edge) => edge.childId === item.id && edge.parentId === tag?.id,
    ),
  );
  const relationshipList = (items: Tag[], parent: boolean) => (
    <ul className="relationship-list">
      {items.map((item) => (
        <li key={item.id}>
          <button className="tag-link" onClick={() => onOpenTag(item.id)}>
            # {item.name}
          </button>
          <span>
            {item.songCount}
            {t(' songs')}
          </span>
          <button
            className="icon-button"
            aria-label={t('Unlink {0}', item.name)}
            disabled={busy}
            onClick={() =>
              void run(async () => {
                await api(
                  `/tags/${parent ? item.id : tag!.id}/children/${parent ? tag!.id : item.id}`,
                  'DELETE',
                );
                onChange();
              })
            }
          >
            ×
          </button>
        </li>
      ))}
    </ul>
  );
  const relationshipForm = (parent: boolean) => {
    const options = library.tags.filter(
      (item) =>
        item.id !== tag?.id &&
        !(parent ? parents : children).some(
          (existing) => existing.id === item.id,
        ),
    );
    return (
      <TagPicker
        label={parent ? t('Parent tag') : t('Child tag')}
        tags={library.tags}
        available={options}
        busy={busy}
        run={run}
        onAssign={async (id) => {
          await api(
            `/tags/${parent ? id : tag!.id}/children/${parent ? tag!.id : id}`,
            'PUT',
          );
          onChange();
        }}
      />
    );
  };
  return (
    <>
      <p className="form-intro">
        {t(
          'Tags are living collections. Connect them to bring whole branches of your library together.',
        )}
      </p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void run(async () => {
            if (tag) {
              await api(`/tags/${tag.id}`, 'PATCH', { name });
              onChange();
              setSaved(true);
            } else {
              const result = await api<{ id: number }>('/tags', 'POST', {
                name,
              });
              onChange();
              onCreated(result.id);
            }
          });
        }}
      >
        <fieldset disabled={busy}>
          <label>
            {t('Tag name')}
            <input
              required
              maxLength={200}
              placeholder={t('A genre, an artist, a feeling…')}
              value={name}
              onChange={(event) => {
                setName(event.target.value);
                setSaved(false);
              }}
            />
          </label>
          <div className="button-row">
            <button className="primary">
              {tag ? t('Save name') : t('Create tag')}
            </button>
            {saved && (
              <span role="status" className="success-text">
                {t('Saved.')}
              </span>
            )}
          </div>
        </fieldset>
      </form>
      {error && (
        <p className="notice error" role="alert">
          {t(error)}
        </p>
      )}
      {tag && (
        <>
          <section className="editor-section">
            <div className="section-title">
              <h3>{t('Parent tags')}</h3>
              <button
                className="text-button"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    await api(`/tags/${tag.id}`, 'PATCH', {
                      pinned: !tag.pinned,
                    });
                    onChange();
                  })
                }
              >
                {tag.pinned ? t('Unpin tag') : t('Pin tag ↑')}
              </button>
            </div>
            <p className="field-note">
              {t('Songs in “{0}” also belong to these tags.', tag.name)}
            </p>
            {relationshipList(parents, true)}
            {relationshipForm(true)}
          </section>
          <section className="editor-section">
            <h3>{t('Child tags')}</h3>
            <p className="field-note">
              {t(
                '“{0}” includes every song in these tags and their descendants.',
                tag.name,
              )}
            </p>
            {relationshipList(children, false)}
            {relationshipForm(false)}
          </section>
          <p className="field-note">
            {t(
              'Multiple parents are welcome. Relationships that create a loop are rejected.',
            )}
          </p>
          <DeleteButton
            label={t('Delete tag')}
            explanation={t(
              'Delete “{0}” and all its relationships and assignments? Songs and other tags will remain. Its children will not be reconnected.',
              tag.name,
            )}
            busy={busy}
            onDelete={() =>
              void run(async () => {
                await api(`/tags/${tag.id}`, 'DELETE');
                onDeleted();
              })
            }
          />
        </>
      )}
    </>
  );
}
