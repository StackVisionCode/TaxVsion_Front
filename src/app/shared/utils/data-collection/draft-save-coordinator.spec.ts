import { describe, expect, it, vi } from 'vitest';
import {
  DraftSaveConflictPendingError,
  DraftSaveCoordinator,
  DraftSaveFailedError,
  type DraftBroadcastChannel,
  type DraftSaveCoordinatorOptions,
  type DraftSaveResult,
  type DraftSnapshot,
} from './draft-save-coordinator';
import {
  createDefinitionConflictLabeler,
  formatDraftConflictValue,
} from './draft-conflict-display';
import type { FormAnswers } from './form-answers.model';
import type { FormDefinition } from './form-definition.model';

describe('DraftSaveCoordinator', () => {
  it('coalesces changes made during autosave before navigation flush completes', async () => {
    vi.useFakeTimers();
    const firstSave = deferred<DraftSaveResult>();
    const save = vi
      .fn<(answers: FormAnswers, rowVersion: string) => Promise<DraftSaveResult>>()
      .mockImplementationOnce(() => firstSave.promise)
      .mockResolvedValueOnce({ outcome: 'saved', rowVersion: 'rv-3' });
    const coordinator = createCoordinator({ save });

    try {
      coordinator.notifyChange('/values/name', 'Ada');
      await vi.advanceTimersByTimeAsync(5_000);
      coordinator.notifyChange('/values/city', 'Santo Domingo');
      const navigationFlush = coordinator.flush();

      expect(save).toHaveBeenCalledTimes(1);
      firstSave.resolve({ outcome: 'saved', rowVersion: 'rv-2' });
      await navigationFlush;

      expect(save).toHaveBeenCalledTimes(2);
      expect(save.mock.calls[1][0].values).toEqual({
        name: 'Ada',
        city: 'Santo Domingo',
      });
      expect(save.mock.calls[1][1]).toBe('rv-2');
      expect(coordinator.snapshot.status).toBe('idle');
    } finally {
      vi.useRealTimers();
    }
  });

  it('auto-merges disjoint paths after a 409 and saves with the remote row version', async () => {
    const save = vi
      .fn<(answers: FormAnswers, rowVersion: string) => Promise<DraftSaveResult>>()
      .mockResolvedValueOnce({ outcome: 'conflict' })
      .mockResolvedValueOnce({ outcome: 'saved', rowVersion: 'rv-3' });
    const coordinator = createCoordinator({
      initial: snapshot({ firstName: 'Base', city: 'Base' }),
      save,
      load: vi.fn().mockResolvedValue(snapshot({ firstName: 'Base', city: 'Remote' }, 'rv-2')),
    });

    coordinator.notifyChange('/values/firstName', 'Local');
    await coordinator.flush();

    expect(save).toHaveBeenCalledTimes(2);
    expect(save.mock.calls[1]).toEqual([answers({ firstName: 'Local', city: 'Remote' }), 'rv-2']);
  });

  it('stops when the same field changed to different values', async () => {
    const save = vi.fn().mockResolvedValue({ outcome: 'conflict' } satisfies DraftSaveResult);
    const coordinator = createCoordinator({
      initial: snapshot({ name: 'Base' }),
      save,
      load: vi.fn().mockResolvedValue(snapshot({ name: 'Remote' }, 'rv-2')),
    });

    coordinator.notifyChange('/values/name', 'Local');
    await expect(coordinator.flush()).rejects.toBeInstanceOf(DraftSaveConflictPendingError);

    expect(save).toHaveBeenCalledTimes(1);
    expect(coordinator.snapshot.status).toBe('conflict');
    expect(coordinator.snapshot.conflicts).toMatchObject([
      { path: '/values/name', localDisplayValue: 'Local', remoteDisplayValue: 'Remote' },
    ]);
  });

  it('accepts the same field value from both sides without a conflict', async () => {
    const save = vi.fn().mockResolvedValue({ outcome: 'conflict' } satisfies DraftSaveResult);
    const coordinator = createCoordinator({
      initial: snapshot({ name: 'Base' }),
      save,
      load: vi.fn().mockResolvedValue(snapshot({ name: 'Shared' }, 'rv-2')),
    });

    coordinator.notifyChange('/values/name', 'Shared');
    await coordinator.flush();

    expect(save).toHaveBeenCalledTimes(1);
    expect(coordinator.snapshot.status).toBe('idle');
    expect(coordinator.snapshot.conflicts).toEqual([]);
  });

  it('reports a conflict when one side deletes a row and the other edits it', async () => {
    const initial = snapshot({
      household: { rows: [{ rowId: 'row-1', values: { name: 'Base' } }] },
    });
    const coordinator = createCoordinator({
      initial,
      save: vi.fn().mockResolvedValue({ outcome: 'conflict' } satisfies DraftSaveResult),
      load: vi.fn().mockResolvedValue(
        snapshot(
          {
            household: { rows: [{ rowId: 'row-1', values: { name: 'Remote' } }] },
          },
          'rv-2',
        ),
      ),
    });

    coordinator.notifyChange('/values/household/rows/row-1', undefined);
    await expect(coordinator.flush()).rejects.toBeInstanceOf(DraftSaveConflictPendingError);

    expect(coordinator.snapshot.conflicts).toMatchObject([
      {
        path: '/values/household/rows/row-1',
        kind: 'row-delete-edit',
        localDisplayValue: 'Row removed',
        remoteDisplayValue: 'Row edited',
      },
    ]);
  });

  it('starts a new conflict cycle when saving a resolution receives another 409', async () => {
    const save = vi.fn().mockResolvedValue({ outcome: 'conflict' } satisfies DraftSaveResult);
    const load = vi
      .fn<() => Promise<DraftSnapshot>>()
      .mockResolvedValueOnce(snapshot({ name: 'Remote 1' }, 'rv-2'))
      .mockResolvedValueOnce(snapshot({ name: 'Remote 2' }, 'rv-3'));
    const coordinator = createCoordinator({ initial: snapshot({ name: 'Base' }), save, load });

    coordinator.notifyChange('/values/name', 'Local');
    await expect(coordinator.flush()).rejects.toBeInstanceOf(DraftSaveConflictPendingError);
    const firstConflict = coordinator.snapshot.conflicts[0];
    await expect(
      coordinator.resolveConflicts({ [firstConflict.id]: 'local' }),
    ).rejects.toBeInstanceOf(DraftSaveConflictPendingError);

    expect(save).toHaveBeenCalledTimes(2);
    expect(load).toHaveBeenCalledTimes(2);
    expect(coordinator.snapshot.status).toBe('conflict');
    expect(coordinator.snapshot.conflicts[0].remoteDisplayValue).toBe('Remote 2');
  });

  it('stops after one automatic retry if the server keeps returning 409', async () => {
    const save = vi.fn().mockResolvedValue({ outcome: 'conflict' } satisfies DraftSaveResult);
    const coordinator = createCoordinator({
      initial: snapshot({ firstName: 'Base', city: 'Base' }),
      save,
      load: vi.fn().mockResolvedValue(snapshot({ firstName: 'Base', city: 'Remote' }, 'rv-2')),
    });

    coordinator.notifyChange('/values/firstName', 'Local');
    await expect(coordinator.flush()).rejects.toBeInstanceOf(DraftSaveFailedError);

    expect(save).toHaveBeenCalledTimes(2);
    expect(coordinator.snapshot.status).toBe('error');
    expect(coordinator.snapshot.answers.values).toEqual({
      firstName: 'Local',
      city: 'Remote',
    });
  });

  it('keeps navigation blocked until the in-flight save finishes', async () => {
    const pendingSave = deferred<DraftSaveResult>();
    const coordinator = createCoordinator({ save: vi.fn(() => pendingSave.promise) });
    let navigated = false;

    coordinator.notifyChange('/values/name', 'Ada');
    const navigation = coordinator.flush().then(() => {
      navigated = true;
    });
    await Promise.resolve();

    expect(navigated).toBe(false);
    pendingSave.resolve({ outcome: 'saved', rowVersion: 'rv-2' });
    await navigation;
    expect(navigated).toBe(true);
  });

  it('does not use keepalive when the pagehide payload reaches 60 KB', () => {
    const saveKeepalive = vi.fn();
    const coordinator = createCoordinator({ saveKeepalive });

    coordinator.notifyChange('/values/notes', 'x'.repeat(61_000));

    expect(coordinator.handlePageHide()).toBe(false);
    expect(saveKeepalive).not.toHaveBeenCalled();
  });

  it('delegates a small pagehide payload to the authorized keepalive adapter', () => {
    const saveKeepalive = vi.fn();
    const coordinator = createCoordinator({ saveKeepalive });

    coordinator.notifyChange('/values/name', 'Ada');

    expect(coordinator.handlePageHide()).toBe(true);
    expect(saveKeepalive).toHaveBeenCalledWith({
      answers: answers({ name: 'Ada' }),
      rowVersion: 'rv-1',
    });
  });

  it('unions attachments added independently by both sides', async () => {
    const save = vi
      .fn<(answers: FormAnswers, rowVersion: string) => Promise<DraftSaveResult>>()
      .mockResolvedValueOnce({ outcome: 'conflict' })
      .mockResolvedValueOnce({ outcome: 'saved', rowVersion: 'rv-3' });
    const coordinator = createCoordinator({
      initial: snapshot({ files: [] }),
      save,
      load: vi.fn().mockResolvedValue(snapshot({ files: [{ fileId: 'remote' }] }, 'rv-2')),
    });

    coordinator.notifyChange('/values/files', [{ fileId: 'local' }]);
    await coordinator.flush();

    expect(save.mock.calls[1][0].values['files']).toEqual([
      { fileId: 'remote' },
      { fileId: 'local' },
    ]);
  });

  it('resolves attachment deletion conflicts at the supported component path', async () => {
    const save = vi
      .fn<(answers: FormAnswers, rowVersion: string) => Promise<DraftSaveResult>>()
      .mockResolvedValueOnce({ outcome: 'conflict' })
      .mockResolvedValueOnce({ outcome: 'saved', rowVersion: 'rv-3' });
    const coordinator = createCoordinator({
      initial: snapshot({ files: [{ fileId: 'base' }] }),
      save,
      load: vi.fn().mockResolvedValue(
        snapshot(
          {
            files: [{ fileId: 'base' }, { fileId: 'remote-addition' }],
          },
          'rv-2',
        ),
      ),
    });

    coordinator.notifyChange('/values/files', []);
    await expect(coordinator.flush()).rejects.toBeInstanceOf(DraftSaveConflictPendingError);
    const conflict = coordinator.snapshot.conflicts[0];
    expect(conflict.path).toBe('/values/files');

    await coordinator.resolveConflicts({ [conflict.id]: 'local' });
    expect(save.mock.calls[1][0].values['files']).toEqual([{ fileId: 'remote-addition' }]);
  });

  it('never exposes the sensitive tax identifier reference in conflict state', async () => {
    const taxId = (sensitiveRef: string) => ({ kind: 'ein', sensitiveRef, last4: '1234' });
    const coordinator = createCoordinator({
      initial: snapshot({ taxId: taxId('vault/base') }),
      save: vi.fn().mockResolvedValue({ outcome: 'conflict' } satisfies DraftSaveResult),
      load: vi.fn().mockResolvedValue(snapshot({ taxId: taxId('vault/remote') }, 'rv-2')),
    });

    coordinator.notifyChange('/values/taxId', taxId('vault/local'));
    await expect(coordinator.flush()).rejects.toBeInstanceOf(DraftSaveConflictPendingError);

    expect(coordinator.snapshot.conflicts[0]).toMatchObject({
      localDisplayValue: '****1234',
      remoteDisplayValue: '****1234',
    });
    expect(JSON.stringify(coordinator.snapshot.conflicts)).not.toContain('vault/');
  });

  it('resolves a conflict inside a composite value by component and does not lock the form', async () => {
    const address = (city: string, line1 = 'Main St') => ({ line1, city, state: 'NY' });
    const save = vi
      .fn<(answers: FormAnswers, rowVersion: string) => Promise<DraftSaveResult>>()
      .mockResolvedValueOnce({ outcome: 'conflict' })
      .mockResolvedValueOnce({ outcome: 'saved', rowVersion: 'rv-3' });
    const coordinator = createCoordinator({
      initial: snapshot({ addr: address('Albany') }),
      save,
      load: vi.fn().mockResolvedValue(snapshot({ addr: address('Buffalo') }, 'rv-2')),
    });

    coordinator.notifyChange('/values/addr', address('Queens'));
    await expect(coordinator.flush()).rejects.toBeInstanceOf(DraftSaveConflictPendingError);
    expect(coordinator.snapshot.conflicts.map((conflict) => conflict.path)).toEqual([
      '/values/addr',
    ]);
    expect(coordinator.canEdit).toBe(false);

    await coordinator.resolveConflicts({ '/values/addr': 'local' });

    expect(save.mock.calls[1]).toEqual([answers({ addr: address('Queens') }), 'rv-2']);
    expect(coordinator.snapshot.status).toBe('idle');
    expect(coordinator.canEdit).toBe(true);
    expect(coordinator.notifyChange('/values/addr', address('Bronx'))).toBe(true);
  });

  it('never mixes subfields of a composite value edited on both sides', async () => {
    const coordinator = createCoordinator({
      initial: snapshot({ addr: { line1: 'Base', city: 'Base' } }),
      save: vi.fn().mockResolvedValue({ outcome: 'conflict' } satisfies DraftSaveResult),
      load: vi
        .fn()
        .mockResolvedValue(snapshot({ addr: { line1: 'Remote', city: 'Base' } }, 'rv-2')),
    });

    coordinator.notifyChange('/values/addr', { line1: 'Base', city: 'Local' });
    await expect(coordinator.flush()).rejects.toBeInstanceOf(DraftSaveConflictPendingError);

    expect(coordinator.snapshot.conflicts).toMatchObject([
      {
        path: '/values/addr',
        componentId: 'addr',
        localValue: { line1: 'Base', city: 'Local' },
        remoteValue: { line1: 'Remote', city: 'Base' },
      },
    ]);
  });

  it('does not report a conflict when both sides removed the same row', async () => {
    const row = (rowId: string, name: string) => ({ rowId, values: { name } });
    const save = vi
      .fn<(answers: FormAnswers, rowVersion: string) => Promise<DraftSaveResult>>()
      .mockResolvedValueOnce({ outcome: 'conflict' })
      .mockResolvedValueOnce({ outcome: 'saved', rowVersion: 'rv-3' });
    const coordinator = createCoordinator({
      initial: snapshot({ household: { rows: [row('r1', 'Ana'), row('r2', 'Luis')] } }),
      save,
      load: vi
        .fn()
        .mockResolvedValue(snapshot({ household: { rows: [row('r2', 'Luis')] } }, 'rv-2')),
    });

    coordinator.notifyChange('/values/household', { rows: [row('r2', 'Luis M.')] });
    await coordinator.flush();

    expect(coordinator.snapshot.conflicts).toEqual([]);
    expect(save.mock.calls[1][0].values).toEqual({ household: { rows: [row('r2', 'Luis M.')] } });
  });

  it('labels a repeater field conflict and formats both values for the dialog', async () => {
    const definition = repeaterDefinition();
    const row = (name: string) => ({ rowId: 'r1', values: { name } });
    const coordinator = createCoordinator({
      initial: snapshot({ household: { rows: [row('Base')] } }),
      save: vi.fn().mockResolvedValue({ outcome: 'conflict' } satisfies DraftSaveResult),
      load: vi.fn().mockResolvedValue(snapshot({ household: { rows: [row('Remote')] } }, 'rv-2')),
      labelFor: createDefinitionConflictLabeler(definition),
    });

    coordinator.notifyChange('/values/household/rows/r1/values/name', 'Local');
    await expect(coordinator.flush()).rejects.toBeInstanceOf(DraftSaveConflictPendingError);
    const conflict = coordinator.snapshot.conflicts[0];

    expect(conflict).toMatchObject({
      path: '/values/household/rows/r1/values/name',
      componentId: 'name',
      sectionId: 'household',
      rowId: 'r1',
      rowIndex: 0,
      label: 'Dependent 1 · First name',
    });
    expect(formatDraftConflictValue(definition, conflict, 'local')).toBe('Local');
    expect(formatDraftConflictValue(definition, conflict, 'remote')).toBe('Remote');
  });

  it('keeps a single request in flight across autosave, exclusive operations and pagehide', async () => {
    let active = 0;
    let maxActive = 0;
    const track = async <T>(result: T, gate: Promise<void>): Promise<T> => {
      active++;
      maxActive = Math.max(maxActive, active);
      await gate;
      active--;
      return result;
    };
    const firstGate = deferred<void>();
    const save = vi
      .fn<(answers: FormAnswers, rowVersion: string) => Promise<DraftSaveResult>>()
      .mockImplementationOnce(() =>
        track<DraftSaveResult>({ outcome: 'saved', rowVersion: 'rv-2' }, firstGate.promise),
      )
      .mockImplementation((_answers, rowVersion) =>
        track<DraftSaveResult>({ outcome: 'saved', rowVersion: rowVersion + '+' }, Promise.resolve()),
      );
    const saveKeepalive = vi.fn();
    const coordinator = createCoordinator({ save, saveKeepalive });
    const operation = vi.fn((rowVersion: string) =>
      track({ value: rowVersion, rowVersion: 'rv-upload' }, Promise.resolve()),
    );

    coordinator.notifyChange('/values/name', 'Ada');
    const firstFlush = coordinator.flush();
    const exclusive = coordinator.runExclusive(operation);
    coordinator.notifyChange('/values/city', 'Santo Domingo');
    void coordinator.handleBlur();
    await Promise.resolve();

    expect(coordinator.snapshot.busy).toBe(true);
    expect(operation).not.toHaveBeenCalled();
    expect(coordinator.handlePageHide()).toBe(false);
    expect(saveKeepalive).not.toHaveBeenCalled();

    firstGate.resolve(undefined);
    await firstFlush;
    await expect(exclusive).resolves.toBe('rv-2');
    coordinator.notifyChange('/values/zip', '10001');
    await coordinator.flush();

    expect(maxActive).toBe(1);
    expect(save).toHaveBeenCalledTimes(2);
    expect(save.mock.calls[1][1]).toBe('rv-upload');
    expect(coordinator.snapshot.status).toBe('idle');
  });

  it('never throws synchronously when read-only or disposed', async () => {
    const hub = new TestChannelHub();
    const save = vi.fn().mockResolvedValue({ outcome: 'saved', rowVersion: 'rv-2' });
    const owner = createCoordinator({
      channelFactory: (name) => hub.open(name),
      tabId: 'a',
      openedAt: 1,
    });
    const viewer = createCoordinator({
      save,
      channelFactory: (name) => hub.open(name),
      tabId: 'b',
      openedAt: 2,
    });

    expect(viewer.snapshot.readOnly).toBe(true);
    expect(viewer.notifyChange('/values/name', 'Ada')).toBe(false);
    await expect(viewer.flush()).resolves.toBeUndefined();
    await expect(viewer.handleBlur()).resolves.toBeUndefined();
    await expect(viewer.runExclusive(async () => ({ value: 1 }))).rejects.toThrow('read-only');
    expect(save).not.toHaveBeenCalled();

    viewer.dispose();
    expect(viewer.notifyChange('/values/name', 'Ada')).toBe(false);
    await expect(viewer.flush()).resolves.toBeUndefined();
    await expect(viewer.handleBlur()).resolves.toBeUndefined();
    expect(() => viewer.takeControl()).not.toThrow();
    expect(viewer.handlePageHide()).toBe(false);
    owner.dispose();
  });

  it('saves pending edits before yielding control to another tab', async () => {
    const hub = new TestChannelHub();
    const save = vi.fn().mockResolvedValue({ outcome: 'saved', rowVersion: 'rv-2' });
    const first = createCoordinator({
      save,
      channelFactory: (name) => hub.open(name),
      tabId: 'a',
      openedAt: 1,
    });
    const second = createCoordinator({
      channelFactory: (name) => hub.open(name),
      tabId: 'b',
      openedAt: 2,
    });

    first.notifyChange('/values/name', 'Ada');
    second.takeControl();
    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(1));

    expect(first.snapshot.readOnly).toBe(true);
    expect(save.mock.calls[0][0].values).toEqual({ name: 'Ada' });
    first.dispose();
    second.dispose();
  });

  it('adopts a server snapshot without local changes by replacing base and row version', async () => {
    const save = vi.fn().mockResolvedValue({ outcome: 'saved', rowVersion: 'rv-4' });
    const coordinator = createCoordinator({ initial: snapshot({ name: 'Base' }), save });

    await coordinator.adoptServerSnapshot(answers({ name: 'Base', files: [{ fileId: 'f1' }] }), 'rv-3');

    expect(coordinator.snapshot.answers.values).toEqual({ name: 'Base', files: [{ fileId: 'f1' }] });
    expect(coordinator.confirmed.rowVersion).toBe('rv-3');
    expect(coordinator.snapshot.changedPaths).toEqual([]);
    coordinator.notifyChange('/values/name', 'Ada');
    await coordinator.flush();
    expect(save).toHaveBeenCalledWith(answers({ name: 'Ada', files: [{ fileId: 'f1' }] }), 'rv-3');
  });

  it('rebases pending changes on an adopted snapshot and reports real conflicts', async () => {
    const coordinator = createCoordinator({
      initial: snapshot({ name: 'Base', city: 'Base' }),
      save: vi.fn().mockResolvedValue({ outcome: 'saved', rowVersion: 'rv-9' }),
    });

    coordinator.notifyChange('/values/name', 'Local');
    await coordinator.adoptServerSnapshot(answers({ name: 'Base', city: 'Remote' }), 'rv-2');
    expect(coordinator.snapshot.answers.values).toEqual({ name: 'Local', city: 'Remote' });
    expect(coordinator.snapshot.changedPaths).toEqual(['/values/name']);

    coordinator.notifyChange('/values/city', 'Mine');
    await coordinator.adoptServerSnapshot(answers({ name: 'Base', city: 'Theirs' }), 'rv-3');
    expect(coordinator.snapshot.status).toBe('conflict');
    expect(coordinator.snapshot.conflicts.map((conflict) => conflict.path)).toEqual(['/values/city']);
    coordinator.dispose();
  });

  it('discards a snapshot handed in while a save confirmed a newer version', async () => {
    const pending = deferred<DraftSaveResult>();
    const coordinator = createCoordinator({ save: vi.fn(() => pending.promise) });

    coordinator.notifyChange('/values/name', 'Ada');
    const flushing = coordinator.flush();
    const adopting = coordinator.adoptServerSnapshot(answers({}), 'rv-old');
    pending.resolve({ outcome: 'saved', rowVersion: 'rv-2' });
    await flushing;

    await expect(adopting).resolves.toBe(false);
    expect(coordinator.snapshot.rowVersion).toBe('rv-2');
    expect(coordinator.snapshot.answers.values).toEqual({ name: 'Ada' });
  });

  it('discards a snapshot read before a save that confirmed afterwards (read token)', async () => {
    const pending = deferred<DraftSaveResult>();
    const coordinator = createCoordinator({ save: vi.fn(() => pending.promise) });
    coordinator.notifyChange('/values/name', 'Ada');
    const token = coordinator.beginServerRead();
    const flushing = coordinator.flush();
    pending.resolve({ outcome: 'saved', rowVersion: 'rv-2' });
    await flushing;

    // El GET empezó antes del PUT: trae la versión anterior y no debe pisar lo guardado.
    await expect(coordinator.adoptServerSnapshot(answers({}), 'rv-1', token)).resolves.toBe(false);
    expect(coordinator.snapshot.answers.values).toEqual({ name: 'Ada' });

    const fresh = coordinator.beginServerRead();
    await expect(
      coordinator.adoptServerSnapshot(answers({ name: 'Ada', city: 'NY' }), 'rv-3', fresh),
    ).resolves.toBe(true);
    expect(coordinator.snapshot.rowVersion).toBe('rv-3');
  });

  it('rejects a queued exclusive operation without running it once a conflict opened', async () => {
    const coordinator = createCoordinator({
      initial: snapshot({ name: 'Base' }),
      save: vi.fn().mockResolvedValue({ outcome: 'conflict' } satisfies DraftSaveResult),
      load: vi.fn().mockResolvedValue(snapshot({ name: 'Remote' }, 'rv-2')),
    });
    const operation = vi.fn(async () => ({ value: 1, snapshot: snapshot({ name: 'Stale' }, 'rv-9') }));

    coordinator.notifyChange('/values/name', 'Local');
    const flushing = coordinator.flush();
    const exclusive = coordinator.runExclusive(operation);
    await expect(flushing).rejects.toBeInstanceOf(DraftSaveConflictPendingError);
    await expect(exclusive).rejects.toBeInstanceOf(DraftSaveConflictPendingError);

    expect(operation).not.toHaveBeenCalled();
    expect(coordinator.snapshot.conflicts[0].remoteValue).toBe('Remote');
    await coordinator.resolveConflicts({ '/values/name': 'remote' });
    expect(coordinator.snapshot.answers.values).toEqual({ name: 'Remote' });
  });

  it('takes control back when the controlling tab closes', () => {
    const hub = new TestChannelHub();
    let pageHide: (() => void) | null = null;
    const lifecycle = {
      document: {
        visibilityState: 'visible' as DocumentVisibilityState,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
      },
      window: {
        addEventListener: (_type: 'pagehide', listener: () => void) => (pageHide = listener),
        removeEventListener: () => undefined,
      },
    };
    const owner = createCoordinator({
      channelFactory: (name) => hub.open(name),
      tabId: 'a',
      openedAt: 1,
      lifecycle,
    });
    const viewer = createCoordinator({ channelFactory: (name) => hub.open(name), tabId: 'b', openedAt: 2 });
    expect(viewer.snapshot.readOnly).toBe(true);

    pageHide!();

    expect(viewer.snapshot.readOnly).toBe(false);
    expect(viewer.canEdit).toBe(true);
    expect(viewer.notifyChange('/values/name', 'Ada')).toBe(true);
    owner.dispose();
    viewer.dispose();
  });

  it('lets the oldest remaining tab write after the controlling tab is disposed', () => {
    const hub = new TestChannelHub();
    const first = createCoordinator({ channelFactory: (name) => hub.open(name), tabId: 'a', openedAt: 1 });
    const second = createCoordinator({ channelFactory: (name) => hub.open(name), tabId: 'b', openedAt: 2 });
    const third = createCoordinator({ channelFactory: (name) => hub.open(name), tabId: 'c', openedAt: 3 });

    first.dispose();

    expect(second.snapshot.readOnly).toBe(false);
    expect(third.snapshot.readOnly).toBe(true);
    second.dispose();
    third.dispose();
  });

  it('clears the other-tab notice when the only read-only tab closes', () => {
    const hub = new TestChannelHub();
    const owner = createCoordinator({ channelFactory: (name) => hub.open(name), tabId: 'a', openedAt: 1 });
    const viewer = createCoordinator({ channelFactory: (name) => hub.open(name), tabId: 'b', openedAt: 2 });
    const third = createCoordinator({ channelFactory: (name) => hub.open(name), tabId: 'c', openedAt: 3 });
    expect(owner.snapshot.otherTabOpen).toBe(true);

    viewer.dispose();
    expect(owner.snapshot.otherTabOpen).toBe(true);
    third.dispose();

    expect(owner.snapshot.otherTabOpen).toBe(false);
    expect(owner.snapshot.readOnly).toBe(false);
    owner.dispose();
  });

  it('detects another tab and transfers write control without sending answers', () => {
    const hub = new TestChannelHub();
    const first = createCoordinator({
      channelFactory: (name) => hub.open(name),
      tabId: 'tab-a',
      openedAt: 1,
    });
    const second = createCoordinator({
      channelFactory: (name) => hub.open(name),
      tabId: 'tab-b',
      openedAt: 2,
    });

    expect(first.snapshot.otherTabOpen).toBe(true);
    expect(first.snapshot.readOnly).toBe(false);
    expect(second.snapshot.otherTabOpen).toBe(true);
    expect(second.snapshot.readOnly).toBe(true);
    expect(JSON.stringify(hub.messages)).not.toContain('answers');

    second.takeControl();
    expect(first.snapshot.readOnly).toBe(true);
    expect(second.snapshot.readOnly).toBe(false);

    first.dispose();
    second.dispose();
  });
});

function createCoordinator(
  overrides: Partial<DraftSaveCoordinatorOptions> = {},
): DraftSaveCoordinator {
  return new DraftSaveCoordinator({
    initial: snapshot({}),
    requestId: 'request-1',
    save: vi.fn().mockResolvedValue({ outcome: 'saved', rowVersion: 'rv-2' }),
    load: vi.fn().mockResolvedValue(snapshot({}, 'rv-2')),
    lifecycle: null,
    channelFactory: null,
    ...overrides,
  });
}

function repeaterDefinition(): FormDefinition {
  return {
    schemaVersion: 1,
    title: 'Intake',
    purpose: 'clientIntake',
    presentation: 'wizard',
    pages: [
      {
        id: 'page',
        title: 'Family',
        sections: [
          {
            id: 'household',
            title: 'Household',
            repeat: { minRows: 0, maxRows: 5, addLabel: 'Add dependent', rowLabel: 'Dependent' },
            components: [{ id: 'name', type: 'text', label: 'First name' }],
          },
        ],
      },
    ],
  };
}

function snapshot(values: Record<string, unknown>, rowVersion = 'rv-1'): DraftSnapshot {
  return { answers: answers(values), rowVersion };
}

function answers(values: Record<string, unknown>): FormAnswers {
  return { schemaVersion: 1, values };
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolver) => {
    resolve = resolver;
  });
  return { promise, resolve };
}

class TestChannelHub {
  readonly messages: unknown[] = [];
  private readonly channels = new Map<string, TestChannel[]>();

  open(name: string): DraftBroadcastChannel {
    const channel = new TestChannel(name, this);
    this.channels.set(name, [...(this.channels.get(name) ?? []), channel]);
    return channel;
  }

  publish(sender: TestChannel, message: unknown): void {
    this.messages.push(message);
    for (const channel of this.channels.get(sender.name) ?? []) {
      if (channel !== sender) channel.receive(message);
    }
  }

  remove(channel: TestChannel): void {
    this.channels.set(
      channel.name,
      (this.channels.get(channel.name) ?? []).filter((item) => item !== channel),
    );
  }
}

class TestChannel implements DraftBroadcastChannel {
  private readonly listeners = new Set<(event: MessageEvent<unknown>) => void>();

  constructor(
    readonly name: string,
    private readonly hub: TestChannelHub,
  ) {}

  postMessage(message: unknown): void {
    this.hub.publish(this, message);
  }

  addEventListener(_type: 'message', listener: (event: MessageEvent<unknown>) => void): void {
    this.listeners.add(listener);
  }

  removeEventListener(_type: 'message', listener: (event: MessageEvent<unknown>) => void): void {
    this.listeners.delete(listener);
  }

  close(): void {
    this.hub.remove(this);
  }

  receive(message: unknown): void {
    const event = { data: message } as MessageEvent<unknown>;
    for (const listener of this.listeners) listener(event);
  }
}
