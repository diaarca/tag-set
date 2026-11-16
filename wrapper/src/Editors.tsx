import { useEffect, useState, type FormEvent } from 'react';
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
              Confirm deletion
            </button>
            <button type="button" onClick={() => setConfirm(false)}>
              Keep it
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
  const [details, setDetails] = useState<SongDetails>();
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const [artists, setArtists] = useState('');
  const [tagId, setTagId] = useState('');
  const [newTag, setNewTag] = useState('');
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
        {loadError}
      </p>
    );
  if (id !== undefined && !details)
    return <p className="muted">Loading song…</p>;
  return (
    <>
      <p className="form-intro">
        A YouTube link, a title, and the artists behind it. Your library takes
        it from there.
      </p>
      <form onSubmit={submit}>
        <fieldset disabled={busy}>
          <label>
            YouTube / YouTube Music URL
            <input
              required
              type="url"
              maxLength={2048}
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="https://music.youtube.com/watch?v=…"
            />
          </label>
          <label>
            Song title
            <input
              required
              maxLength={500}
              value={title}
              onChange={(event) => {
                setTitle(event.target.value);
                setSaved(false);
              }}
              placeholder="What’s this song called?"
            />
          </label>
          <label>
            Artists <span className="field-hint">one per line</span>
            <textarea
              required
              rows={2}
              value={artists}
              onChange={(event) => {
                setArtists(event.target.value);
                setSaved(false);
              }}
              placeholder="Daft Punk"
            />
          </label>
          <p className="field-note">
            Each artist gets a tag automatically. Artist credits stay separate
            from tag names.
          </p>
          <div className="button-row">
            <button className="primary" type="submit">
              {busy
                ? 'Saving…'
                : id === undefined
                  ? 'Add to library'
                  : 'Save song'}
            </button>
            {saved && (
              <span role="status" className="success-text">
                Saved.
              </span>
            )}
          </div>
        </fieldset>
      </form>
      {error && (
        <div className="notice error" role="alert">
          {error}
        </div>
      )}
      {details && (
        <section className="editor-section">
          <h3>Tags on this song</h3>
          <p className="field-note">
            Remove direct assignments here. Inherited membership follows the
            linked tag relationships.
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
                    {member.artist && <span>Artist tag</span>}
                    {member.manual && <span>Added directly</span>}
                    {member.inheritedVia.map((child) => (
                      <span key={child}>
                        Via{' '}
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
                    aria-label={`Remove direct ${name(member.tagId)} tag`}
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
          <form
            className="inline-form"
            onSubmit={(event) => {
              event.preventDefault();
              if (tagId)
                void run(async () => {
                  await api(`/songs/${id}/tags/${tagId}`, 'PUT');
                  setTagId('');
                  await refreshTags();
                });
            }}
          >
            <select
              aria-label="Tag to assign"
              value={tagId}
              onChange={(event) => setTagId(event.target.value)}
              disabled={busy}
            >
              <option value="">Choose a tag…</option>
              {available.map((tag) => (
                <option key={tag.id} value={tag.id}>
                  {tag.name}
                </option>
              ))}
            </select>
            <button disabled={busy || !tagId}>Add tag</button>
          </form>
          <form
            className="inline-form"
            onSubmit={(event) => {
              event.preventDefault();
              void run(async () => {
                const tag = await api<{ id: number }>('/tags', 'POST', {
                  name: newTag,
                });
                await api(`/songs/${id}/tags/${tag.id}`, 'PUT');
                setNewTag('');
                await refreshTags();
              });
            }}
          >
            <input
              aria-label="New tag name"
              maxLength={200}
              required
              value={newTag}
              onChange={(event) => setNewTag(event.target.value)}
              placeholder="Or create a new tag…"
              disabled={busy}
            />
            <button disabled={busy || !newTag.trim()}>Create & add</button>
          </form>
          <DeleteButton
            label="Delete song"
            explanation="Remove this song and its assignments from your library? Tags and the original YouTube video will remain."
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
  const [name, setName] = useState(tag?.name ?? '');
  const [parentId, setParentId] = useState('');
  const [childId, setChildId] = useState('');
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
          <span>{item.songCount} songs</span>
          <button
            className="icon-button"
            aria-label={`Unlink ${item.name}`}
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
    const value = parent ? parentId : childId;
    const options = library.tags.filter(
      (item) =>
        item.id !== tag?.id &&
        !(parent ? parents : children).some(
          (existing) => existing.id === item.id,
        ),
    );
    return (
      <form
        className="inline-form"
        onSubmit={(event) => {
          event.preventDefault();
          void run(async () => {
            await api(
              `/tags/${parent ? value : tag!.id}/children/${parent ? tag!.id : value}`,
              'PUT',
            );
            if (parent) setParentId('');
            else setChildId('');
            onChange();
          });
        }}
      >
        <select
          aria-label={parent ? 'Parent tag' : 'Child tag'}
          value={value}
          onChange={(event) =>
            parent
              ? setParentId(event.target.value)
              : setChildId(event.target.value)
          }
          disabled={busy}
        >
          <option value="">
            {parent ? 'Choose a parent…' : 'Choose a child…'}
          </option>
          {options.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
        <button disabled={busy || !value}>Connect</button>
      </form>
    );
  };
  return (
    <>
      <p className="form-intro">
        Tags are living collections. Connect them to bring whole branches of
        your library together.
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
            Tag name
            <input
              required
              maxLength={200}
              placeholder="A genre, an artist, a feeling…"
              value={name}
              onChange={(event) => {
                setName(event.target.value);
                setSaved(false);
              }}
            />
          </label>
          <div className="button-row">
            <button className="primary">
              {tag ? 'Save name' : 'Create tag'}
            </button>
            {saved && (
              <span role="status" className="success-text">
                Saved.
              </span>
            )}
          </div>
        </fieldset>
      </form>
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      {tag && (
        <>
          <section className="editor-section">
            <div className="section-title">
              <h3>Parent tags</h3>
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
                {tag.pinned ? 'Unpin tag' : 'Pin tag ↑'}
              </button>
            </div>
            <p className="field-note">
              Songs in “{tag.name}” also belong to these tags.
            </p>
            {relationshipList(parents, true)}
            {relationshipForm(true)}
          </section>
          <section className="editor-section">
            <h3>Child tags</h3>
            <p className="field-note">
              “{tag.name}” includes every song in these tags and their
              descendants.
            </p>
            {relationshipList(children, false)}
            {relationshipForm(false)}
          </section>
          <p className="field-note">
            Multiple parents are welcome. Relationships that create a loop are
            rejected.
          </p>
          <DeleteButton
            label="Delete tag"
            explanation={`Delete “${tag.name}” and all its relationships and assignments? Songs and other tags will remain. Its children will not be reconnected.`}
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
