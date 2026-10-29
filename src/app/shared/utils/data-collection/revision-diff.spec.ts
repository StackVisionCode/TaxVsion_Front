import type { FormAnswers } from './form-answers.model';
import { revisionDiff } from './revision-diff';

describe('revisionDiff', () => {
  it('reports changed, added and removed component values', () => {
    const previous: FormAnswers = { schemaVersion: 1, values: { name: 'Ada', removed: true } };
    const current: FormAnswers = { schemaVersion: 1, values: { name: 'Grace', added: 42 } };

    expect(revisionDiff(previous, current)).toEqual([
      { componentId: 'added', rowId: null, kind: 'added', before: undefined, after: 42 },
      { componentId: 'name', rowId: null, kind: 'changed', before: 'Ada', after: 'Grace' },
      { componentId: 'removed', rowId: null, kind: 'removed', before: true, after: undefined },
    ]);
  });

  it('compares repeater values by component and row id', () => {
    const previous: FormAnswers = {
      schemaVersion: 1,
      values: { people: { rows: [{ rowId: 'row-a', values: { firstName: 'Ada' } }] } },
    };
    const current: FormAnswers = {
      schemaVersion: 1,
      values: { people: { rows: [{ rowId: 'row-a', values: { firstName: 'Grace' } }] } },
    };

    expect(revisionDiff(previous, current)).toEqual([
      { componentId: 'firstName', rowId: 'row-a', kind: 'changed', before: 'Ada', after: 'Grace' },
    ]);
  });

  it('ignores object key order', () => {
    const previous: FormAnswers = {
      schemaVersion: 1,
      values: { address: { city: 'Austin', state: 'TX' } },
    };
    const current: FormAnswers = {
      schemaVersion: 1,
      values: { address: { state: 'TX', city: 'Austin' } },
    };

    expect(revisionDiff(previous, current)).toEqual([]);
  });
});
