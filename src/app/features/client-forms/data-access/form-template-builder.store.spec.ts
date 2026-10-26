import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { Subject, of, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FormDefinition } from '@shared/utils/data-collection/form-definition.model';
import type { FormTemplateDetail } from './client-forms.model';
import { FormTemplateBuilderStore } from './form-template-builder.store';
import { FormTemplatesService } from './form-templates.service';

/** BroadcastChannel en memoria y síncrono: cada test controla qué pestañas existen. */
class FakeChannel {
  static open: FakeChannel[] = [];
  private readonly listeners = new Set<(event: MessageEvent<unknown>) => void>();
  constructor(readonly name: string) {
    FakeChannel.open.push(this);
  }
  postMessage(data: unknown): void {
    for (const channel of FakeChannel.open)
      if (channel !== this && channel.name === this.name)
        for (const listener of channel.listeners) listener({ data } as MessageEvent<unknown>);
  }
  addEventListener(_type: 'message', listener: (event: MessageEvent<unknown>) => void): void {
    this.listeners.add(listener);
  }
  removeEventListener(_type: 'message', listener: (event: MessageEvent<unknown>) => void): void {
    this.listeners.delete(listener);
  }
  close(): void {
    FakeChannel.open = FakeChannel.open.filter((channel) => channel !== this);
  }
}

describe('FormTemplateBuilderStore', () => {
  let store: FormTemplateBuilderStore;
  let service: ReturnType<typeof serviceMock>;

  beforeEach(() => {
    vi.useFakeTimers();
    FakeChannel.open = [];
    vi.stubGlobal('BroadcastChannel', FakeChannel);
    service = serviceMock();
    TestBed.configureTestingModule({
      providers: [FormTemplateBuilderStore, { provide: FormTemplatesService, useValue: service }],
    });
    store = TestBed.inject(FormTemplateBuilderStore);
  });

  afterEach(() => {
    store.dispose();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('selects the first section on load so the palette adds there', async () => {
    await store.load('template-1');
    expect(store.selection()).toEqual({ kind: 'section', id: 'sc_abcdefghij' });
  });

  it('tracks selection and supports undo and redo', async () => {
    await store.load('template-1');
    store.select({ kind: 'section', id: 'sc_abcdefghij' });
    store.change((definition) => ({ ...definition, title: 'Changed' }));
    expect(store.selection()).toEqual({ kind: 'section', id: 'sc_abcdefghij' });
    expect(store.definition()?.title).toBe('Changed');
    store.undo();
    expect(store.definition()?.title).toBe('Original');
    store.redo();
    expect(store.definition()?.title).toBe('Changed');
  });

  it('autosaves after two seconds', async () => {
    await store.load('template-1');
    store.change((definition) => ({ ...definition, title: 'Autosaved' }));
    await vi.advanceTimersByTimeAsync(2_000);
    expect(service.updateDraft).toHaveBeenCalledWith(
      'template-1',
      expect.objectContaining({ title: 'Autosaved' }),
      'AQ==',
    );
    expect(store.saveStatus()).toBe('saved');
  });

  it('rebases non-overlapping changes after a 409', async () => {
    const remote = definition();
    remote.description = {
      type: 'doc',
      blocks: [{ type: 'paragraph', children: [{ type: 'text', text: 'Remote' }] }],
    };
    service.get.mockReturnValueOnce(of(detail())).mockReturnValueOnce(of(detail(remote, 'Ag==')));
    service.updateDraft
      .mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 409 })))
      .mockReturnValueOnce(
        of({ updated: true, rowVersion: 'Aw==', draftHash: 'hash', issues: [] }),
      );
    await store.load('template-1');
    store.change((current) => ({ ...current, title: 'Mine' }));
    await vi.advanceTimersByTimeAsync(2_000);
    await vi.runAllTimersAsync();
    expect(store.definition()?.title).toBe('Mine');
    expect(store.definition()?.description).toEqual(remote.description);
    expect(store.conflicts()).toEqual([]);
  });

  it('rebases a 409 with new pages and sections, renames, reorders and a field in a deleted section', async () => {
    const remote = richDefinition();
    remote.pages.push({ id: 'pg_remote', title: 'Remote page', sections: [{ id: 'sc_remote', components: [] }] });
    remote.pages[0].sections[0].components.reverse();
    remote.pages[0].sections.splice(1, 1);
    service.get
      .mockReturnValueOnce(of(detail(richDefinition())))
      .mockReturnValueOnce(of(detail(remote, 'Ag==')));
    service.updateDraft.mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 409 })));
    await store.load('template-1');

    store.change((current) => {
      current.pages[0].title = 'Renamed page';
      current.pages[0].sections[0].title = 'Renamed section';
      current.pages[0].sections.push({ id: 'sc_local', title: 'Local section', components: [] });
      current.pages[0].sections[1].components.push({ id: 'fd_new', type: 'text', label: 'New field' });
      return current;
    });
    await vi.advanceTimersByTimeAsync(2_000);

    expect(store.saveStatus()).toBe('conflict');
    expect(store.conflicts().map((conflict) => conflict.label)).toEqual(['Section "Second"']);
    const merged = store.definition()!;
    expect(merged.pages.map((page) => page.id)).toEqual(['pg_abcdefghij', 'pg_remote']);
    expect(merged.pages[0].title).toBe('Renamed page');
    expect(merged.pages[0].sections.map((section) => section.title)).toEqual([
      'Renamed section',
      'Second',
      'Local section',
    ]);
    expect(merged.pages[0].sections[0].components.map((item) => item.id)).toEqual(['fd_b', 'fd_a']);
    expect(merged.pages[0].sections[1].components.map((item) => item.id)).toContain('fd_new');
    expect(store.canUndo()).toBe(false);

    await store.resolveConflicts({ [store.conflicts()[0].id]: 'mine' });
    expect(service.updateDraft).toHaveBeenLastCalledWith(
      'template-1',
      expect.objectContaining({ pages: merged.pages }),
      'Ag==',
    );
    expect(store.saveStatus()).toBe('saved');
  });

  it('keeps edits made while a save is in flight', async () => {
    const pending = new Subject<{ updated: boolean; rowVersion: string; draftHash: string; issues: [] }>();
    service.updateDraft.mockReturnValueOnce(pending);
    await store.load('template-1');

    store.change((current) => ({ ...current, title: 'First' }));
    await vi.advanceTimersByTimeAsync(2_000);
    store.change((current) => ({ ...current, presentation: 'singlePage' }));
    pending.next({ updated: true, rowVersion: 'Ag==', draftHash: 'h', issues: [] });
    pending.complete();
    await vi.runAllTimersAsync();

    expect(service.updateDraft).toHaveBeenCalledTimes(2);
    expect(service.updateDraft).toHaveBeenLastCalledWith(
      'template-1',
      expect.objectContaining({ title: 'First', presentation: 'singlePage' }),
      'Ag==',
    );
    expect(store.definition()?.title).toBe('First');
  });

  it('pauses editing in a second tab until it takes control', async () => {
    await store.load('template-1');
    await vi.advanceTimersByTimeAsync(5);
    const other = TestBed.runInInjectionContext(() => new FormTemplateBuilderStore());
    await other.load('template-1');

    expect(other.readOnly()).toBe(true);
    other.change((current) => ({ ...current, title: 'From the second tab' }));
    expect(other.definition()?.title).toBe('Original');

    other.takeControl();
    expect(other.readOnly()).toBe(false);
    expect(store.readOnly()).toBe(true);
    other.change((current) => ({ ...current, title: 'From the second tab' }));
    expect(other.definition()?.title).toBe('From the second tab');
    other.dispose();
  });

  it('saves pending changes when disposed', async () => {
    await store.load('template-1');
    store.change((current) => ({ ...current, title: 'Leaving now' }));

    store.dispose();
    await vi.runAllTimersAsync();

    expect(service.updateDraft).toHaveBeenCalledWith(
      'template-1',
      expect.objectContaining({ title: 'Leaving now' }),
      'AQ==',
    );
  });

  it('saves the previous template and edits the new one when another id is loaded', async () => {
    service.get.mockImplementation((id?: string) => of({ ...detail(), id: id ?? 'template-1' }));
    await store.load('template-1');
    store.change((current) => ({ ...current, title: 'Pending on the first' }));

    await store.load('template-2');
    await vi.advanceTimersByTimeAsync(0);
    expect(service.updateDraft).toHaveBeenCalledWith(
      'template-1',
      expect.objectContaining({ title: 'Pending on the first' }),
      'AQ==',
    );

    store.change((current) => ({ ...current, title: 'Edited on the second' }));
    await vi.advanceTimersByTimeAsync(2_000);
    expect(store.template()?.id).toBe('template-2');
    expect(service.updateDraft).toHaveBeenLastCalledWith(
      'template-2',
      expect.objectContaining({ title: 'Edited on the second' }),
      'AQ==',
    );
  });

  it('does not report a read-only tab with unsaved changes as saved', async () => {
    service.updateDraft.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 500 })));
    await store.load('template-1');
    store.change((current) => ({ ...current, title: 'Unsaved' }));
    await vi.advanceTimersByTimeAsync(5);
    const other = TestBed.runInInjectionContext(() => new FormTemplateBuilderStore());
    await other.load('template-1');
    other.takeControl();
    await vi.runAllTimersAsync();

    expect(store.readOnly()).toBe(true);
    expect(store.dirty()).toBe(true);
    await expect(store.trySave()).resolves.toBe(false);
    other.dispose();
  });

  it('refreshes the row version after publishing', async () => {
    await store.load('template-1');
    service.publish.mockReturnValue(
      of({ published: true, version: publishedVersion(1), issues: [] }),
    );
    service.get.mockReturnValueOnce(of(detail(definition(), 'Ag==', 1)));

    await expect(store.publish()).resolves.toBe(1);

    expect(service.publish).toHaveBeenCalledWith('template-1', 'AQ==');
    expect(store.template()?.rowVersion).toBe('Ag==');
    expect(store.template()?.latestVersionNumber).toBe(1);
  });

  it('shows validation issues returned by a rejected publish', async () => {
    await store.load('template-1');
    const issues = [{ code: 'field.required', path: '/pages/0', message: 'A field is required.' }];
    service.publish.mockReturnValue(
      throwError(() => new HttpErrorResponse({ status: 422, error: { issues } })),
    );

    await expect(store.publish()).resolves.toBeNull();

    expect(store.issues()).toEqual(issues);
  });

  it('duplicates the current draft without selecting a published version', async () => {
    await store.load('template-1');
    service.duplicate.mockReturnValue(of(detail()));

    await expect(store.duplicateDraft()).resolves.toBe('template-1');

    expect(service.duplicate).toHaveBeenCalledWith('template-1');
  });

  it('archives with the latest row version', async () => {
    await store.load('template-1');
    service.archive.mockReturnValue(of({ ...detail(), status: 'Archived' as const }));

    await expect(store.archive()).resolves.toBe(true);

    expect(service.archive).toHaveBeenCalledWith('template-1', 'AQ==');
    expect(store.template()?.status).toBe('Archived');
  });

  it('keeps action failures out of the load error so the builder stays visible', async () => {
    await store.load('template-1');
    service.publish.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 500 })));
    service.archive.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 500 })));

    await store.publish();
    expect(store.error()).toBe('');
    expect(store.actionError()).toBe('The template could not be published.');
    await store.archive();
    expect(store.actionError()).toBe('The template could not be archived.');
    expect(store.definition()).not.toBeNull();
    store.dismissActionError();
    expect(store.actionError()).toBe('');
  });

  it('reports failed validate, restore and version history loads', async () => {
    await store.load('template-1');
    service.validate.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 500 })));
    service.revert.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 500 })));
    service.versions.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 500 })));

    await store.validate();
    expect(store.actionError()).toBe('The template could not be validated.');
    await store.restoreVersion(1);
    expect(store.actionError()).toBe('The version could not be restored.');
    await store.loadVersions();
    expect(store.actionError()).toBe('The version history could not be loaded.');
    expect(store.error()).toBe('');
  });

  it('refuses mapping or action changes while rule sets are locked', async () => {
    await store.load('template-1');
    store.lockRuleSets(true);
    store.change((value) => ({ ...value, actions: [{ key: 'summary', type: 'generateSummary', trigger: 'onComplete' }] }));
    expect(store.definition()?.actions ?? []).toEqual([]);
    expect(store.actionError()).toContain('Configure actions');

    store.change((value) => ({ ...value, title: 'Renamed' }));
    expect(store.definition()?.title).toBe('Renamed');

    store.lockRuleSets(false);
    store.change((value) => ({ ...value, actions: [{ key: 'summary', type: 'generateSummary', trigger: 'onComplete' }] }));
    expect(store.definition()?.actions).toHaveLength(1);
  });
});

function serviceMock() {
  return {
    get: vi.fn((_id?: string) => of(detail())),
    updateDraft: vi.fn(() =>
      of({ updated: true, rowVersion: 'Ag==', draftHash: 'hash', issues: [] }),
    ),
    validate: vi.fn(() => of({ issues: [] })),
    publish: vi.fn(),
    revert: vi.fn(),
    version: vi.fn(),
    duplicate: vi.fn(),
    archive: vi.fn(),
    versions: vi.fn(() => of([])),
  };
}

function detail(
  value = definition(),
  rowVersion = 'AQ==',
  latestVersionNumber = 0,
): FormTemplateDetail {
  return {
    id: 'template-1',
    name: 'Test',
    description: null,
    purpose: 'clientIntake',
    status: 'Active',
    latestVersionNumber,
    draftUpdatedAtUtc: '2026-10-24T00:00:00Z',
    draft: JSON.stringify(value),
    draftHash: 'hash',
    rowVersion,
    latestVersionId: null,
    draftUpdatedByUserId: 'user-1',
    versions: [],
  };
}

function publishedVersion(versionNumber: number) {
  return {
    id: `version-${versionNumber}`,
    templateId: 'template-1',
    versionNumber,
    schemaVersion: 1,
    title: 'Original',
    purpose: 'clientIntake' as const,
    presentation: 'wizard' as const,
    definition: JSON.stringify(definition()),
    contentHash: 'hash',
    componentCount: 0,
    publishedAtUtc: '2026-10-24T00:00:00Z',
    publishedByUserId: 'user-1',
    targetCatalogVersion: 1,
  };
}

function definition(): FormDefinition {
  return {
    schemaVersion: 1,
    title: 'Original',
    purpose: 'clientIntake',
    presentation: 'wizard',
    pages: [
      { id: 'pg_abcdefghij', title: 'Page 1', sections: [{ id: 'sc_abcdefghij', components: [] }] },
    ],
  };
}

function richDefinition(): FormDefinition {
  return {
    schemaVersion: 1,
    title: 'Original',
    purpose: 'clientIntake',
    presentation: 'wizard',
    pages: [
      {
        id: 'pg_abcdefghij',
        title: 'Page 1',
        sections: [
          {
            id: 'sc_abcdefghij',
            title: 'First',
            components: [
              { id: 'fd_a', type: 'text', label: 'A' },
              { id: 'fd_b', type: 'text', label: 'B' },
            ],
          },
          { id: 'sc_second0000', title: 'Second', components: [{ id: 'fd_c', type: 'text', label: 'C' }] },
        ],
      },
    ],
  };
}
