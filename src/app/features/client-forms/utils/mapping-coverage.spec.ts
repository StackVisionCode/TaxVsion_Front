import type { FormAction, FormMapping } from '@shared/utils/data-collection/form-definition.model';
import { onboardingDefinition, testCatalog } from '../testing/mapping-catalog.fixture';
import { computeCoverage } from './mapping-coverage';

const CREATE: FormAction = {
  key: 'create_client',
  type: 'createCustomer',
  trigger: 'onSubmit',
  config: { kind: { constant: 'Individual' }, language: { mapped: true }, waitFor: 'none' },
};

const FULL_MAPPINGS: FormMapping[] = [
  { componentId: 'fd_first0001', targetKey: 'customer.person.first_name', transform: 'trim' },
  { componentId: 'fd_last00001', targetKey: 'customer.person.last_name', transform: 'trim' },
  { componentId: 'fd_email0001', targetKey: 'customer.primary_email', transform: 'trim' },
  {
    componentId: 'fd_lang00001',
    targetKey: 'customer.language',
    optionMap: { spanish: 'Es', en: 'En' },
  },
];

describe('computeCoverage', () => {
  it('is ready when there are no actions and no mappings', () => {
    const coverage = computeCoverage(onboardingDefinition(), testCatalog());
    expect(coverage.actions).toEqual([]);
    expect(coverage.ready).toBe(true);
  });

  it('lists the required targets of Create client for the fixed client kind only', () => {
    const coverage = computeCoverage(onboardingDefinition({ actions: [CREATE] }), testCatalog());
    const action = coverage.actions[0];
    expect(action.state).toBe('missing');
    expect(action.missing.map((item) => item.targetKey)).toEqual([
      'customer.person.first_name',
      'customer.person.last_name',
      'customer.primary_email',
      'customer.language',
    ]);
    expect(action.missing[0].kinds).toEqual(['Individual']);
    expect(action.missing[2].kinds).toEqual([]);
    expect(coverage.ready).toBe(false);
  });

  it('offers unmapped compatible fields as candidates', () => {
    const coverage = computeCoverage(onboardingDefinition({ actions: [CREATE] }), testCatalog());
    const email = coverage.actions[0].missing.find((item) => item.targetKey === 'customer.primary_email');
    expect(email?.candidates).toEqual([{ componentId: 'fd_email0001', label: 'Email' }]);
    const first = coverage.actions[0].missing[0];
    // Los campos del repeater nunca son candidatos a un destino escalar.
    expect(first.candidates.map((item) => item.componentId)).toEqual([
      'fd_first0001',
      'fd_last00001',
      'fd_notes0001',
    ]);
  });

  it('asks for every kind when the client kind is neither fixed nor mapped', () => {
    const action = { ...CREATE, config: { language: { mapped: true } } };
    const coverage = computeCoverage(onboardingDefinition({ actions: [action] }), testCatalog());
    const keys = coverage.actions[0].missing.map((item) => item.targetKey);
    expect(keys).toContain('customer.kind');
    expect(keys).toContain('customer.business.legal_name');
    expect(keys).toContain('customer.person.first_name');
  });

  it('is ready for Create client once every required target is mapped', () => {
    const coverage = computeCoverage(
      onboardingDefinition({ actions: [CREATE], mappings: FULL_MAPPINGS }),
      testCatalog(),
    );
    expect(coverage.actions[0]).toMatchObject({ state: 'ready', operation: 'CreateCustomer', missing: [] });
    expect(coverage.ready).toBe(true);
  });

  it('flags a mapped source that is not required', () => {
    const definition = onboardingDefinition({ actions: [CREATE], mappings: FULL_MAPPINGS });
    definition.pages[0].sections[0].components[2].required = false;
    const action = computeCoverage(definition, testCatalog()).actions[0];
    expect(action.state).toBe('missing');
    expect(action.fieldProblems).toEqual([
      expect.objectContaining({ componentId: 'fd_email0001', code: 'mapping.source_not_required', exists: true }),
    ]);
  });

  it('reports an invalid fixed value in the action config', () => {
    const action = { ...CREATE, config: { kind: { constant: 'Robot' }, language: { constant: 'En' } } };
    const coverage = computeCoverage(
      onboardingDefinition({ actions: [action], mappings: FULL_MAPPINGS.slice(0, 3) }),
      testCatalog(),
    );
    expect(coverage.actions[0].configProblems).toEqual(["A fixed value isn't accepted by the client record."]);
  });

  // Antes solo ofrecía "Remove mapping"; el arreglo útil es acortar el campo al largo del destino.
  it('offers "Limit to 80" for a field longer than the client property', () => {
    const definition = onboardingDefinition({
      mappings: [{ componentId: 'fd_first0001', targetKey: 'customer.person.first_name', transform: 'trim' }],
    });
    const first = definition.pages[0].sections[0].components.find((item) => item.id === 'fd_first0001')!;
    first.props = { ...first.props, maxLength: 200 };

    const problem = computeCoverage(definition, testCatalog()).fieldProblems.find(
      (item) => item.code === 'mapping.length_exceeds_target',
    );

    expect(problem?.fix).toEqual({
      label: 'Limit to 80',
      componentId: 'fd_first0001',
      patch: { props: { maxLength: 80 } },
    });
  });

  it('reports orphan and incomplete mappings as field problems', () => {
    const coverage = computeCoverage(
      onboardingDefinition({
        mappings: [
          { componentId: 'fd_gone00001', targetKey: 'customer.primary_phone' },
          { componentId: 'fd_lang00001', targetKey: 'customer.language', optionMap: { spanish: 'Es' } },
        ],
      }),
      testCatalog(),
    );
    expect(coverage.fieldProblems).toEqual([
      expect.objectContaining({ componentId: 'fd_gone00001', code: 'mapping.invalid_target', exists: false }),
      expect.objectContaining({ componentId: 'fd_lang00001', code: 'mapping.option_map_incomplete', exists: true }),
    ]);
    expect(coverage.ready).toBe(false);
  });

  it('offers repeater sections as candidates for a required collection target', () => {
    const catalog = testCatalog();
    const dependents = catalog.targets.find((item) => item.targetKey === 'customer.relation.dependents')!;
    dependents.requiredFor = [{ operation: 'CreateCustomer', kind: null }];
    const action = computeCoverage(onboardingDefinition({ actions: [CREATE] }), catalog).actions[0];
    expect(action.missing.find((item) => item.targetKey === dependents.targetKey)?.candidates).toEqual([
      { componentId: 'sc_deps00001', label: 'Dependents' },
    ]);
  });

  it('reports an incomplete repeater mapping on its section', () => {
    const coverage = computeCoverage(
      onboardingDefinition({
        mappings: [
          { componentId: 'sc_deps00001', targetKey: 'customer.relation.dependents', rowFields: { fd_depname1: 'first_name' } },
        ],
      }),
      testCatalog(),
    );
    expect(coverage.fieldProblems).toEqual([
      expect.objectContaining({
        componentId: 'sc_deps00001',
        label: 'Dependents',
        code: 'mapping.required_target_missing',
        exists: true,
      }),
    ]);
  });

  it('marks actions without data mapping as not required and missing operations as unavailable', () => {
    const catalog = testCatalog();
    catalog.operations = catalog.operations.filter((item) => item.name !== 'UpdateCustomerProfile');
    const coverage = computeCoverage(
      onboardingDefinition({
        actions: [
          { key: 'summary', type: 'generateSummary', trigger: 'onComplete' },
          { key: 'update_profile', type: 'updateCustomerProfile', trigger: 'manual' },
        ],
      }),
      catalog,
    );
    expect(coverage.actions.map((item) => item.state)).toEqual(['notRequired', 'unavailable']);
    expect(coverage.ready).toBe(false);
  });
});
