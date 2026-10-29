import { onboardingDefinition } from '../testing/mapping-catalog.fixture';
import {
  FORM_ACTION_CATALOG,
  actionLabel,
  hasSignatureStep,
  nextActionKey,
  operationName,
  triggerAllowed,
} from './form-action-catalog';

describe('form action catalog', () => {
  it('covers exactly the closed FormActionType list', () => {
    expect(FORM_ACTION_CATALOG.map((item) => item.type)).toEqual([
      'notifyStaff',
      'routeToReview',
      'createCustomer',
      'updateCustomerProfile',
      'generateSummary',
      'requestSignature',
      'applyRetentionClass',
    ]);
  });

  it('allows the same triggers as the structure validator', () => {
    expect(triggerAllowed('createCustomer', 'onSubmit')).toBe(true);
    expect(triggerAllowed('createCustomer', 'manual')).toBe(true);
    expect(triggerAllowed('createCustomer', 'onComplete')).toBe(false);
    expect(triggerAllowed('updateCustomerProfile', 'manual')).toBe(true);
    expect(triggerAllowed('updateCustomerProfile', 'onSubmit')).toBe(false);
    expect(triggerAllowed('generateSummary', 'onComplete')).toBe(true);
    expect(triggerAllowed('applyRetentionClass', 'onSubmit')).toBe(false);
    for (const descriptor of FORM_ACTION_CATALOG)
      expect(descriptor.triggers).toContain(descriptor.defaultTrigger);
  });

  it('marks the H4 flows as automatic and keeps implicit actions out of configuration', () => {
    const byType = new Map(FORM_ACTION_CATALOG.map((item) => [item.type, item]));
    for (const type of ['updateCustomerProfile', 'generateSummary', 'requestSignature', 'applyRetentionClass'] as const) {
      expect(byType.get(type)?.availability).toBe('automatic');
      expect(byType.get(type)?.automatic?.note).toBeTruthy();
    }
    expect(byType.get('createCustomer')?.availability).toBe('available');
    expect(byType.get('notifyStaff')?.implicit).toBe(true);
    expect(byType.get('routeToReview')?.implicit).toBe(true);
  });

  it('generates valid unique keys', () => {
    const actions = [
      { key: 'create_client', type: 'createCustomer' as const, trigger: 'manual' as const },
      { key: 'create_client_2', type: 'createCustomer' as const, trigger: 'manual' as const },
    ];
    expect(nextActionKey([], 'create_client')).toBe('create_client');
    expect(nextActionKey(actions, 'create_client')).toBe('create_client_3');
    for (const descriptor of FORM_ACTION_CATALOG) expect(descriptor.key).toMatch(/^[a-z][a-z0-9_]{1,63}$/);
  });

  it('maps action types to operation names and labels', () => {
    expect(operationName('createCustomer')).toBe('CreateCustomer');
    expect(actionLabel('createCustomer')).toBe('Create client');
  });

  it('detects a signature step', () => {
    const definition = onboardingDefinition();
    expect(hasSignatureStep(definition)).toBe(false);
    definition.pages[0].sections[0].components.push({ id: 'fd_sign00001', type: 'signatureStep' });
    expect(hasSignatureStep(definition)).toBe(true);
  });
});
