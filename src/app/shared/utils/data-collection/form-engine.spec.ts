import { describe, expect, it } from 'vitest';
import { DEFAULT_DATA_COLLECTION_LIMITS } from './data-collection-limits';
import type { FormDefinition } from './form-definition.model';
import { FormEngine } from './form-engine';

const repeat = '"repeat":{"minRows":0,"maxRows":2,"addLabel":"Add","rowLabel":"Row"}';
function definition(componentExtra = '', sectionExtra = ''): string {
  return `{"schemaVersion":1,"title":"T","purpose":"clientIntake","presentation":"wizard","pages":[{"id":"pg_abcdefgh","title":"Page","sections":[{"id":"sc_abcdefgh","title":"Rows"${sectionExtra},"components":[{"id":"fd_abcdefgh","type":"text","label":"Name"${componentExtra}}]}]}]}`;
}

describe('FormEngine', () => {
  describe('parseDefinition', () => {
    it('reports a nested repeater instead of invalid JSON', () => {
      const result = new FormEngine().parseDefinition(definition(`,${repeat}`, `,${repeat}`));

      expect(result.isSuccess).toBe(false);
      if (!result.isSuccess) expect(result.error.code).toBe('repeater.nested');
    });

    it('keeps invalid JSON for other unknown component properties', () => {
      const result = new FormEngine().parseDefinition(definition(',"rows":[]'));

      expect(result.isSuccess).toBe(false);
      if (!result.isSuccess) expect(result.error.code).toBe('definition.invalid_json');
    });
  });

  describe('validateAnswers', () => {
    const dateDefinition: FormDefinition = {
      schemaVersion: 1,
      title: 'T',
      purpose: 'clientIntake',
      presentation: 'wizard',
      pages: [
        {
          id: 'pg_abcdefgh',
          title: 'Page',
          sections: [
            {
              id: 'sc_abcdefgh',
              title: 'Section',
              components: [
                { id: 'fd_abcdefgh', type: 'date', label: 'When', props: { max: 'today' } },
              ],
            },
          ],
        },
      ],
    };
    const clock = () => new Date(Date.UTC(2026, 2, 15, 23, 30));

    it.each([
      ['2026-03-15', true],
      ['2026-03-16', false],
    ])('uses the injected clock for "today" (%s)', (answer, valid) => {
      const engine = new FormEngine(DEFAULT_DATA_COLLECTION_LIMITS, clock);

      const report = engine.validateAnswers(
        dateDefinition,
        { schemaVersion: 1, values: { fd_abcdefgh: answer } },
        'submit',
      );

      expect(report.issues.length === 0).toBe(valid);
      if (!valid) expect(report.issues.map((item) => item.code)).toContain('answer.out_of_range');
    });
  });
});
