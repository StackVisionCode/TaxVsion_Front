import { describe, expect, it } from 'vitest';
import { FormEngine } from '@shared/utils/data-collection/form-engine';
import { componentTypes } from '@shared/utils/data-collection/component-registry';
import type { FormDefinition } from '@shared/utils/data-collection/form-definition.model';
import {
  addComponent,
  addPage,
  addSection,
  duplicateComponent,
  earlierInputComponents,
  moveComponent,
  removeComponent,
  updateComponent,
} from './definition-mutations';

describe('definition mutations', () => {
  const engine = new FormEngine();

  it('preserves structural validity while adding and moving fields', () => {
    let definition = emptyDefinition();
    definition = addPage(definition);
    definition = addSection(definition, definition.pages[0].id);
    definition = addComponent(definition, definition.pages[0].sections[0].id, 'text');
    const componentId = definition.pages[0].sections[0].components[0].id;
    definition = duplicateComponent(definition, componentId);
    definition = moveComponent(definition, componentId, definition.pages[0].sections[1].id, 0);

    expect(engine.validateForDraft(definition).issues).toEqual([]);
    expect(componentId).toMatch(/^fd_[a-z0-9]{10}$/);
    expect(definition.pages[1].id).toMatch(/^pg_[a-z0-9]{10}$/);
  });

  it('blocks deleting a field referenced by a later condition', () => {
    let definition = addComponent(emptyDefinition(), 'sc_abcdefghij', 'text');
    const first = definition.pages[0].sections[0].components[0];
    definition = addComponent(definition, 'sc_abcdefghij', 'text');
    const second = definition.pages[0].sections[0].components[1];
    definition = updateComponent(definition, second.id, {
      visibleWhen: { field: first.id, op: 'isAnswered' },
    });

    const result = removeComponent(definition, first.id);

    expect(result.blockedBy).toHaveLength(1);
    expect(result.definition).toEqual(definition);
  });

  it('creates structurally valid defaults for every palette component', () => {
    for (const type of componentTypes()) {
      const definition = addComponent(emptyDefinition(), 'sc_abcdefghij', type.name);

      expect(engine.validateForDraft(definition).issues, type.name).toEqual([]);
    }
  });

  it('keeps the signature step and its action in sync', () => {
    let definition = addComponent(emptyDefinition(), 'sc_abcdefghij', 'signatureStep');
    const signatureId = definition.pages[0].sections[0].components[0].id;

    expect(definition.actions).toEqual([
      { key: 'sign', type: 'requestSignature', trigger: 'onSubmit' },
    ]);
    expect(duplicateComponent(definition, signatureId)).toEqual(definition);
    definition = removeComponent(definition, signatureId).definition;
    expect(definition.actions).toEqual([]);
    expect(engine.validateForDraft(definition).issues).toEqual([]);
  });

  it('stops waiting for the signature when the signature step goes away', () => {
    let definition = addComponent(emptyDefinition(), 'sc_abcdefghij', 'signatureStep');
    const signatureId = definition.pages[0].sections[0].components[0].id;
    definition = {
      ...definition,
      actions: [
        ...(definition.actions ?? []),
        { key: 'create_client', type: 'createCustomer', trigger: 'onSubmit', config: { waitFor: 'signatureCompleted' } },
      ],
    };

    definition = removeComponent(definition, signatureId).definition;

    expect(definition.actions).toEqual([
      { key: 'create_client', type: 'createCustomer', trigger: 'onSubmit', config: { waitFor: 'none' } },
    ]);
    expect(engine.validateForDraft(definition).issues).toEqual([]);
  });

  it('finds earlier fields for an empty later section', () => {
    let definition = addComponent(emptyDefinition(), 'sc_abcdefghij', 'text');
    definition = addSection(definition, 'pg_abcdefghij');
    const first = definition.pages[0].sections[0].components[0];
    const laterSection = definition.pages[0].sections[1];

    expect(earlierInputComponents(definition, { kind: 'section', id: laterSection.id })).toEqual([
      first,
    ]);
  });

  it('blocks deleting a field referenced by an action condition', () => {
    let definition = addComponent(emptyDefinition(), 'sc_abcdefghij', 'text');
    const field = definition.pages[0].sections[0].components[0];
    definition = {
      ...definition,
      actions: [
        {
          key: 'create_customer',
          type: 'createCustomer',
          trigger: 'manual',
          condition: { field: field.id, op: 'isAnswered' },
        },
      ],
    };

    expect(removeComponent(definition, field.id).blockedBy).toEqual([
      { ownerId: 'create_customer', ownerLabel: 'Action create_customer', property: 'condition' },
    ]);
  });
});

function emptyDefinition(): FormDefinition {
  return {
    schemaVersion: 1,
    title: 'Client intake',
    purpose: 'clientIntake',
    presentation: 'wizard',
    pages: [
      {
        id: 'pg_abcdefghij',
        title: 'Page 1',
        sections: [{ id: 'sc_abcdefghij', components: [] }],
      },
    ],
  };
}
