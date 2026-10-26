import { onboardingDefinition, testCatalog } from '../testing/mapping-catalog.fixture';
import {
  allowedTransforms,
  collectionTargets,
  humanizeFieldName,
  missingRowFields,
  rowFieldCandidates,
  rowFieldWarnings,
  suggestRowFields,
  compatibleTargets,
  componentOptions,
  createMapping,
  domainsOf,
  entitiesOf,
  findComponentContext,
  isOptionMapComplete,
  limitLabels,
  mappingUnavailableReason,
  mappingWarnings,
  requirementLabels,
  suggestOptionMap,
} from './mapping-compatibility';

function context(id: string) {
  const found = findComponentContext(onboardingDefinition(), id);
  if (!found) throw new Error(id);
  return found;
}

function target(key: string) {
  const found = testCatalog().targets.find((item) => item.targetKey === key);
  if (!found) throw new Error(key);
  return found;
}

describe('mapping compatibility', () => {
  it('filters targets by the component types the backend declares', () => {
    const keys = compatibleTargets(testCatalog(), context('fd_first0001')).map((item) => item.targetKey);
    expect(keys).toEqual(['customer.person.first_name', 'customer.person.last_name', 'customer.business.legal_name']);
    expect(compatibleTargets(testCatalog(), context('fd_email0001')).map((item) => item.targetKey)).toEqual([
      'customer.primary_email',
    ]);
  });

  it('hides deprecated targets unless they are already selected', () => {
    const catalog = testCatalog();
    catalog.targets.find((item) => item.targetKey === 'customer.primary_email')!.status = 'deprecated';
    expect(compatibleTargets(catalog, context('fd_email0001'))).toEqual([]);
    expect(compatibleTargets(catalog, context('fd_email0001'), 'customer.primary_email')).toHaveLength(1);
  });

  it('explains why a field cannot be mapped', () => {
    const catalog = testCatalog();
    expect(mappingUnavailableReason(catalog, context('fd_file00001'))).toBe('unsupportedType');
    expect(mappingUnavailableReason(catalog, context('fd_depname1'))).toBe('inRepeater');
    // Sin destinos restringidos en el catálogo (usuario sin admin), el SSN no tiene a dónde ir.
    expect(mappingUnavailableReason(catalog, context('fd_ssn000001'))).toBe('noTargets');
    expect(mappingUnavailableReason(catalog, context('fd_first0001'))).toBeNull();
  });

  it('groups targets by domain and entity', () => {
    const targets = testCatalog().targets;
    expect(domainsOf(targets)).toEqual(['Customer']);
    expect(entitiesOf(targets, 'Customer')).toEqual(['Customer', 'Address', 'Relation']);
  });

  it('mirrors the allowed transforms of the engine', () => {
    expect(allowedTransforms('string')).toContain('digitsOnly');
    expect(allowedTransforms('email')).toEqual(['none', 'trim', 'lowercase']);
    expect(allowedTransforms('phone')).toEqual(['none', 'trim']);
    expect(allowedTransforms('enum')).toEqual(['none']);
  });

  it('builds requirement and limit badges', () => {
    expect(requirementLabels(target('customer.person.first_name'))).toEqual(['Create client (Individual)']);
    expect(requirementLabels(target('customer.primary_email'))).toEqual(['Create client']);
    expect(limitLabels(target('customer.person.first_name'))).toEqual(['Max 80 characters', 'Personal data']);
    expect(limitLabels(target('customer.business.formation_date'))).toContain('Past dates only');
  });

  it('warns about length and past dates with a one-click fix', () => {
    const notes = context('fd_notes0001').component;
    expect(mappingWarnings(notes, target('customer.person.first_name'))).toEqual([
      {
        message: 'This field allows 2000 characters, but the client record accepts 80.',
        fixLabel: 'Limit to 80',
        fix: { props: { maxLength: 80 } },
      },
    ]);
    const date = { id: 'fd_date00001', type: 'date', label: 'Founded', props: {} };
    expect(mappingWarnings(date, target('customer.business.formation_date'))).toEqual([
      {
        message: 'This property only accepts past dates.',
        fixLabel: 'Use today as the latest date',
        fix: { props: { max: 'today' } },
      },
    ]);
    expect(mappingWarnings({ ...date, props: { max: 'today' } }, target('customer.business.formation_date'))).toEqual([]);
  });

  it('suggests and checks option maps against the target values', () => {
    const options = componentOptions(context('fd_lang00001').component);
    expect(options).toEqual([
      { value: 'spanish', label: 'Spanish' },
      { value: 'en', label: 'English' },
    ]);
    const values = ['Es', 'En', 'Pt', 'Fr'];
    const suggested = suggestOptionMap(options, values, { spanish: 'Es' });
    expect(suggested).toEqual({ spanish: 'Es', en: 'En' });
    expect(isOptionMapComplete(options, suggested, values)).toBe(true);
    expect(isOptionMapComplete(options, { spanish: 'Es' }, values)).toBe(false);
    expect(isOptionMapComplete(options, { spanish: 'Es', en: 'Xx' }, values)).toBe(false);
  });

  it('creates a mapping with trim for text and a suggested option map for enums', () => {
    expect(createMapping(context('fd_first0001').component, target('customer.person.first_name'))).toEqual({
      componentId: 'fd_first0001',
      targetKey: 'customer.person.first_name',
      transform: 'trim',
    });
    expect(createMapping(context('fd_lang00001').component, target('customer.language'))).toEqual({
      componentId: 'fd_lang00001',
      targetKey: 'customer.language',
      transform: 'none',
      optionMap: { en: 'En' },
    });
  });
});

describe('repeater mapping', () => {
  const definition = onboardingDefinition();
  const section = definition.pages[0].sections[1];
  const dependents = () => target('customer.relation.dependents');

  it('lists collection targets only', () => {
    expect(collectionTargets(testCatalog()).map((item) => item.targetKey)).toEqual(['customer.relation.dependents']);
  });

  it('finds compatible row components and suggests rowFields by label', () => {
    expect(rowFieldCandidates(definition, section, dependents(), 'date_of_birth').map((item) => item.id)).toEqual([
      'fd_depdob001',
    ]);
    expect(suggestRowFields(definition, section, dependents(), { fd_deplast01: 'first_name', fd_ghost001: 'x' })).toEqual({
      fd_deplast01: 'first_name',
      fd_depdob001: 'date_of_birth',
    });
  });

  it('reports missing required row fields and length warnings', () => {
    expect(missingRowFields(dependents(), { fd_depname1: 'first_name' })).toEqual(['last_name']);
    expect(rowFieldWarnings(section, dependents(), { fd_deplast01: 'last_name' })).toEqual([
      '"Last name" allows 200 characters, but Last name accepts 80.',
    ]);
    expect(humanizeFieldName('date_of_birth')).toBe('Date of birth');
  });
});
