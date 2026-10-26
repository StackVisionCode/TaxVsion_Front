import { describe, expect, it, vi } from 'vitest';
import { DEFINITION_DRAFT_MODEL, describeDefinitionPath } from './draft-definition-model';
import { DRAFT_MISSING } from './draft-save-coordinator';
import {
  DraftSaveConflictPendingError,
  DraftSaveCoordinator,
  type DraftSaveResult,
} from './draft-save-coordinator';
import type { FormComponent, FormDefinition, FormSection } from './form-definition.model';

const text = (id: string, label = id): FormComponent => ({ id, type: 'text', label });
const section = (id: string, components: FormComponent[], title = id): FormSection => ({
  id,
  title,
  components,
});

function base(): FormDefinition {
  return {
    schemaVersion: 1,
    title: 'Intake',
    purpose: 'clientIntake',
    presentation: 'wizard',
    pages: [
      {
        id: 'pg_one',
        title: 'One',
        sections: [section('sc_a', [text('fd_1'), text('fd_2'), text('fd_3')]), section('sc_b', [text('fd_4')])],
      },
    ],
  };
}

function merge(local: FormDefinition, remote: FormDefinition, before = base()) {
  return DEFINITION_DRAFT_MODEL.merge(before, local, remote);
}

describe('DEFINITION_DRAFT_MODEL', () => {
  it('merges new pages, new sections, renames, conditions and reorders from both sides', () => {
    const local = base();
    local.pages[0].sections[0].title = 'Renamed here';
    local.pages[0].sections[1].visibleWhen = { field: 'fd_1', op: 'isAnswered' };
    local.pages[0].sections.push(section('sc_new_local', [text('fd_local')]));
    const remote = base();
    remote.pages.push({ id: 'pg_remote', title: 'Remote page', sections: [section('sc_r', [text('fd_r')])] });
    remote.pages[0].sections[0].components.reverse();
    remote.pages[0].sections[1].style = { background: 'sunken' };

    const result = merge(local, remote);

    expect(result.conflicts).toEqual([]);
    const [one, two] = result.value.pages;
    expect(two.id).toBe('pg_remote');
    expect(one.sections.map((item) => item.id)).toEqual(['sc_a', 'sc_b', 'sc_new_local']);
    expect(one.sections[0].title).toBe('Renamed here');
    expect(one.sections[0].components.map((item) => item.id)).toEqual(['fd_3', 'fd_2', 'fd_1']);
    expect(one.sections[1].visibleWhen).toEqual({ field: 'fd_1', op: 'isAnswered' });
    expect(one.sections[1].style).toEqual({ background: 'sunken' });
  });

  it('keeps a component added here to a section deleted elsewhere and asks about the section', () => {
    const local = base();
    local.pages[0].sections[1].components.push(text('fd_new', 'New field'));
    const remote = base();
    remote.pages[0].sections.splice(1, 1);

    const result = merge(local, remote);

    expect(result.conflicts.map((item) => item.path)).toEqual(['/sections/sc_b']);
    expect(result.value.pages[0].sections[1].components.map((item) => item.id)).toEqual([
      'fd_4',
      'fd_new',
    ]);
    const deleted = DEFINITION_DRAFT_MODEL.apply(result.value, '/sections/sc_b', result.conflicts[0].remote);
    expect(deleted.pages[0].sections.map((item) => item.id)).toEqual(['sc_a']);
  });

  it('restores the page when the new section lives in a page deleted elsewhere', () => {
    const local = base();
    local.pages[0].sections.push(section('sc_new', [text('fd_new')]));
    const remote = base();
    remote.pages = [{ id: 'pg_other', title: 'Other', sections: [section('sc_x', [])] }];

    const result = merge(local, remote);

    expect(result.conflicts.map((item) => item.path)).toEqual(['/pages/pg_one']);
    expect(result.value.pages.map((page) => page.id)).toEqual(['pg_other', 'pg_one']);
    // "Keep mine" devuelve la página tal como estaba aquí; "Keep theirs" la borra entera.
    expect(result.value.pages[1].sections.map((item) => item.id)).toEqual(['sc_a', 'sc_b', 'sc_new']);
    const removed = DEFINITION_DRAFT_MODEL.apply(result.value, '/pages/pg_one', result.conflicts[0].remote);
    expect(removed.pages.map((page) => page.id)).toEqual(['pg_other']);
  });

  it('reports the same field edited differently and a field edited here but deleted elsewhere', () => {
    const local = base();
    local.pages[0].sections[0].components[0].label = 'Mine';
    local.pages[0].sections[0].components[1].label = 'Edited here';
    const remote = base();
    remote.pages[0].sections[0].components[0].label = 'Theirs';
    remote.pages[0].sections[0].components.splice(1, 1);

    const result = merge(local, remote);

    expect(result.conflicts.map((item) => item.path).sort()).toEqual(['/components/fd_1', '/components/fd_2']);
    const kept = DEFINITION_DRAFT_MODEL.apply(result.value, '/components/fd_2', result.conflicts.find((item) => item.path === '/components/fd_2')!.local);
    expect(kept.pages[0].sections[0].components.map((item) => item.label)).toContain('Edited here');
  });

  it('keeps non-clashing section properties on both sides of a section conflict', () => {
    const local = base();
    local.pages[0].sections[0].title = 'Mine';
    local.pages[0].sections[0].style = { background: 'sand' };
    const remote = base();
    remote.pages[0].sections[0].title = 'Theirs';
    remote.pages[0].sections[0].visibleWhen = { field: 'fd_4', op: 'isAnswered' };

    const result = merge(local, remote);

    expect(result.conflicts.map((item) => item.path)).toEqual(['/sections/sc_a']);
    const mine = DEFINITION_DRAFT_MODEL.apply(result.value, '/sections/sc_a', result.conflicts[0].local);
    expect(mine.pages[0].sections[0]).toMatchObject({
      title: 'Mine',
      style: { background: 'sand' },
      visibleWhen: { field: 'fd_4', op: 'isAnswered' },
    });
    expect(mine.pages[0].sections[0].components).toHaveLength(3);
  });

  it('asks before losing fields added elsewhere to a section deleted here', () => {
    const local = base();
    local.pages[0].sections.splice(1, 1);
    const remote = base();
    remote.pages[0].sections[1].components.push(text('fd_remote', 'Added elsewhere'));

    const result = merge(local, remote);

    expect(result.conflicts.map((item) => item.path)).toEqual(['/sections/sc_b']);
    const [conflict] = result.conflicts;
    expect(conflict.local).toBe(DRAFT_MISSING);
    // El candidato muestra la sección con su contenido remoto; "theirs" la conserva.
    const theirs = DEFINITION_DRAFT_MODEL.apply(result.value, conflict.path, conflict.remote);
    expect(theirs.pages[0].sections[1].components.map((item) => item.id)).toEqual(['fd_4', 'fd_remote']);
    const mine = DEFINITION_DRAFT_MODEL.apply(result.value, conflict.path, conflict.local);
    expect(mine.pages[0].sections.map((item) => item.id)).toEqual(['sc_a']);
  });

  it('asks before losing a field edited elsewhere inside a section deleted here', () => {
    const local = base();
    local.pages[0].sections.splice(1, 1);
    const remote = base();
    remote.pages[0].sections[1].components[0].label = 'Edited elsewhere';

    const result = merge(local, remote);

    expect(result.conflicts.map((item) => item.path)).toEqual(['/components/fd_4', '/sections/sc_b']);
    expect(result.value.pages[0].sections[1].components[0].label).toBe('Edited elsewhere');
    let theirs = result.value;
    for (const item of result.conflicts) theirs = DEFINITION_DRAFT_MODEL.apply(theirs, item.path, item.remote);
    expect(theirs.pages[0].sections[1].components[0].label).toBe('Edited elsewhere');
    let mine = result.value;
    for (const item of result.conflicts) mine = DEFINITION_DRAFT_MODEL.apply(mine, item.path, item.local);
    expect(mine.pages[0].sections.map((item) => item.id)).toEqual(['sc_a']);
  });

  it('keeps the remote content of a section renamed elsewhere and deleted here', () => {
    const local = base();
    local.pages[0].sections.splice(1, 1);
    const remote = base();
    remote.pages[0].sections[1].title = 'Renamed elsewhere';

    const result = merge(local, remote);

    expect(result.conflicts.map((item) => item.path)).toEqual(['/sections/sc_b']);
    expect(result.value.pages[0].sections[1]).toMatchObject({
      title: 'Renamed elsewhere',
      components: [{ id: 'fd_4' }],
    });
  });

  it('reports two different reorders of the same list as a conflict', () => {
    const local = base();
    local.pages[0].sections[0].components = [text('fd_2'), text('fd_1'), text('fd_3')];
    const remote = base();
    remote.pages[0].sections[0].components = [text('fd_3'), text('fd_1'), text('fd_2')];

    const result = merge(local, remote);

    expect(result.conflicts.map((item) => item.path)).toEqual(['/order/sections/sc_a']);
    expect(describeDefinitionPath('/order/sections/sc_a')).toEqual({
      kind: 'order',
      id: 'sc_a',
      container: 'section',
    });
  });

  it('keeps a component moved here when the other side only edited elsewhere', () => {
    const local = base();
    const [moved] = local.pages[0].sections[0].components.splice(0, 1);
    local.pages[0].sections[1].components.unshift(moved);
    const remote = base();
    remote.title = 'Renamed form';

    const result = merge(local, remote);

    expect(result.conflicts).toEqual([]);
    expect(result.value.title).toBe('Renamed form');
    expect(result.value.pages[0].sections[1].components.map((item) => item.id)).toEqual(['fd_1', 'fd_4']);
    expect(result.value.pages[0].sections[0].components.map((item) => item.id)).toEqual(['fd_2', 'fd_3']);
  });
});

describe('DraftSaveCoordinator with the definition model', () => {
  it('rebases from the current local state, keeping edits made while the save was in flight', async () => {
    let releaseFirst!: (result: DraftSaveResult) => void;
    const save = vi
      .fn<(definition: FormDefinition, rowVersion: string) => Promise<DraftSaveResult>>()
      .mockImplementationOnce(() => new Promise((resolve) => (releaseFirst = resolve)))
      .mockResolvedValue({ outcome: 'saved', rowVersion: 'rv-3' });
    const remote = base();
    remote.pages[0].sections[1].title = 'Remote rename';
    const coordinator = new DraftSaveCoordinator<FormDefinition>({
      initial: { answers: base(), rowVersion: 'rv-1' },
      requestId: 'template-1',
      model: DEFINITION_DRAFT_MODEL,
      save,
      load: vi.fn().mockResolvedValue({ answers: remote, rowVersion: 'rv-2' }),
      lifecycle: null,
      channelFactory: null,
    });

    const first = base();
    first.title = 'First edit';
    coordinator.notifyDocument(first);
    const flushing = coordinator.flush();
    await Promise.resolve();
    const second = structuredClone(first);
    second.pages[0].sections[0].components.push(text('fd_during', 'Added while saving'));
    coordinator.notifyDocument(second);
    releaseFirst({ outcome: 'conflict' });
    await flushing;

    const saved = save.mock.calls.at(-1)![0];
    expect(save.mock.calls.at(-1)![1]).toBe('rv-2');
    expect(saved.title).toBe('First edit');
    expect(saved.pages[0].sections[1].title).toBe('Remote rename');
    expect(saved.pages[0].sections[0].components.map((item) => item.id)).toContain('fd_during');
  });

  it('stops on a real conflict and resolves it by element', async () => {
    const remote = base();
    remote.pages[0].sections[0].components[0].label = 'Theirs';
    const save = vi
      .fn<(definition: FormDefinition, rowVersion: string) => Promise<DraftSaveResult>>()
      .mockResolvedValueOnce({ outcome: 'conflict' })
      .mockResolvedValue({ outcome: 'saved', rowVersion: 'rv-3' });
    const coordinator = new DraftSaveCoordinator<FormDefinition>({
      initial: { answers: base(), rowVersion: 'rv-1' },
      requestId: 'template-1',
      model: DEFINITION_DRAFT_MODEL,
      save,
      load: vi.fn().mockResolvedValue({ answers: remote, rowVersion: 'rv-2' }),
      labelFor: () => 'Field "fd_1"',
      lifecycle: null,
      channelFactory: null,
    });
    const local = base();
    local.pages[0].sections[0].components[0].label = 'Mine';

    coordinator.notifyDocument(local);
    await expect(coordinator.flush()).rejects.toBeInstanceOf(DraftSaveConflictPendingError);
    expect(coordinator.snapshot.conflicts).toMatchObject([
      { path: '/components/fd_1', componentId: 'fd_1', label: 'Field "fd_1"' },
    ]);

    await coordinator.resolveConflicts({ '/components/fd_1': 'local' });
    expect(save.mock.calls.at(-1)![0].pages[0].sections[0].components[0].label).toBe('Mine');
    expect(coordinator.snapshot.status).toBe('idle');
  });
});
