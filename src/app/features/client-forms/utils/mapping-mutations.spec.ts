import { onboardingDefinition } from '../testing/mapping-catalog.fixture';
import {
  mappingFor,
  mappingReferences,
  removeMapping,
  setActions,
  setComponentMapping,
  withoutComponentMappings,
  withoutStaleRowFields,
} from './mapping-mutations';

describe('mapping mutations', () => {
  const first = { componentId: 'fd_first0001', targetKey: 'customer.person.first_name' };
  const email = { componentId: 'fd_email0001', targetKey: 'customer.primary_email' };

  it('adds, replaces in place and removes the mapping of a component', () => {
    const base = onboardingDefinition({ mappings: [first, email] });
    const replaced = setComponentMapping(base, 'fd_first0001', {
      ...first,
      targetKey: 'customer.person.last_name',
    });
    expect(replaced.mappings?.map((item) => item.targetKey)).toEqual([
      'customer.person.last_name',
      'customer.primary_email',
    ]);
    expect(base.mappings?.[0].targetKey).toBe('customer.person.first_name');

    const added = setComponentMapping(onboardingDefinition(), 'fd_email0001', email);
    expect(added.mappings).toEqual([email]);

    const removed = setComponentMapping(base, 'fd_email0001', null);
    expect(removed.mappings).toEqual([first]);
    expect(setComponentMapping(added, 'fd_first0001', null)).toBe(added);
  });

  it('forces the component id of the mapping', () => {
    const next = setComponentMapping(onboardingDefinition(), 'fd_first0001', { ...email });
    expect(mappingFor(next, 'fd_first0001')?.targetKey).toBe('customer.primary_email');
    expect(mappingFor(next, 'fd_email0001')).toBeNull();
  });

  it('replaces the action list', () => {
    const actions = [{ key: 'summary', type: 'generateSummary' as const, trigger: 'onComplete' as const }];
    expect(setActions(onboardingDefinition(), actions).actions).toBe(actions);
  });
});

describe('mapping cleanup', () => {
  const dependents = {
    componentId: 'sc_deps00001',
    targetKey: 'customer.relation.dependents',
    rowFields: { fd_depname1: 'first_name', fd_deplast01: 'last_name' },
  };
  const email = { componentId: 'fd_email0001', targetKey: 'customer.primary_email' };

  it('removes a single row field or the whole mapping', () => {
    const base = onboardingDefinition({ mappings: [dependents, email] });
    const row = removeMapping(base, { mappingComponentId: 'sc_deps00001', rowComponentId: 'fd_deplast01' });
    expect(mappingFor(row, 'sc_deps00001')?.rowFields).toEqual({ fd_depname1: 'first_name' });
    const whole = removeMapping(base, { mappingComponentId: 'fd_email0001', rowComponentId: null });
    expect(whole.mappings?.map((item) => item.componentId)).toEqual(['sc_deps00001']);
    expect(removeMapping(base, { mappingComponentId: 'sc_deps00001', rowComponentId: 'fd_nope00001' })).toBe(base);
  });

  it('finds every mapping a component feeds and drops them when it is deleted', () => {
    const base = onboardingDefinition({ mappings: [dependents, email] });
    expect(mappingReferences(base, 'fd_depname1')).toEqual({ own: false, rowsOf: ['sc_deps00001'] });
    expect(mappingReferences(base, 'fd_email0001')).toEqual({ own: true, rowsOf: [] });
    const next = withoutComponentMappings(withoutComponentMappings(base, 'fd_depname1'), 'fd_email0001');
    expect(next.mappings).toEqual([{ ...dependents, rowFields: { fd_deplast01: 'last_name' } }]);
  });

  it('drops a row field once the component leaves its repeater', () => {
    const base = onboardingDefinition({ mappings: [dependents] });
    expect(withoutStaleRowFields(base, 'fd_depname1')).toBe(base);
    const moved = structuredClone(base);
    const [component] = moved.pages[0].sections[1].components.splice(0, 1);
    moved.pages[0].sections[0].components.push(component);
    expect(mappingFor(withoutStaleRowFields(moved, 'fd_depname1'), 'sc_deps00001')?.rowFields).toEqual({
      fd_deplast01: 'last_name',
    });
  });
});
