import { onboardingDefinition } from '../testing/mapping-catalog.fixture';
import { nextOptionValue, optionUsage } from './option-values';

describe('option values', () => {
  it('never reuses an existing value', () => {
    expect(nextOptionValue([])).toBe('option1');
    expect(
      nextOptionValue([
        { value: 'option3', label: 'C' },
        { value: 'spanish', label: 'Spanish' },
      ]),
    ).toBe('option4');
  });

  it('reports where an option value is used', () => {
    const definition = onboardingDefinition({
      mappings: [{ componentId: 'fd_lang00001', targetKey: 'customer.language', optionMap: { spanish: 'Es' } }],
    });
    definition.pages[0].sections[0].components[4].visibleWhen = {
      any: [{ field: 'fd_lang00001', op: 'in', value: ['spanish'] }],
    };
    expect(optionUsage(definition, 'fd_lang00001', 'spanish')).toEqual({ mapped: true, conditions: ['Notes'] });
    expect(optionUsage(definition, 'fd_lang00001', 'en')).toEqual({ mapped: false, conditions: [] });
    expect(optionUsage(null, 'fd_lang00001', 'en')).toEqual({ mapped: false, conditions: [] });
  });
});
