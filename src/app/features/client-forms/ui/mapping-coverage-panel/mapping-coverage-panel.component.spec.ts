import { ComponentFixture, TestBed } from '@angular/core/testing';
import type { FormAction, FormDefinition } from '@shared/utils/data-collection/form-definition.model';
import { onboardingDefinition, testCatalog } from '../../testing/mapping-catalog.fixture';
import { MappingCoveragePanelComponent } from './mapping-coverage-panel.component';

const CREATE: FormAction = {
  key: 'create_client',
  type: 'createCustomer',
  trigger: 'onSubmit',
  config: { kind: { constant: 'Individual' }, language: { constant: 'En' } },
};

describe('MappingCoveragePanelComponent', () => {
  let fixture: ComponentFixture<MappingCoveragePanelComponent>;

  function render(definition: FormDefinition, extra: Record<string, unknown> = {}) {
    fixture.componentRef.setInput('definition', definition);
    fixture.componentRef.setInput('catalog', testCatalog());
    for (const [key, value] of Object.entries(extra)) fixture.componentRef.setInput(key, value);
    fixture.detectChanges();
  }

  function element(): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  function button(text: string): HTMLButtonElement {
    const found = [...element().querySelectorAll('button')].find((item) => item.textContent?.includes(text));
    if (!found) throw new Error(`Missing button ${text}`);
    return found;
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [MappingCoveragePanelComponent] }).compileComponents();
    fixture = TestBed.createComponent(MappingCoveragePanelComponent);
  });

  it('shows an empty state without actions', () => {
    render(onboardingDefinition());
    expect(element().querySelector('[data-testid="coverage-empty"]')).not.toBeNull();
  });

  it('lists what Create client is missing and links to candidate fields', () => {
    render(onboardingDefinition({ actions: [CREATE] }));
    const missing = [...element().querySelectorAll('[data-testid="coverage-missing"]')].map(
      (item) => item.textContent?.replace(/\s+/g, ' ').trim(),
    );
    expect(missing[0]).toContain('First name · for Individual');
    expect(missing.some((text) => text?.includes('Primary email'))).toBe(true);
    expect(element().textContent).toContain('3 to fix');

    const selected: string[] = [];
    fixture.componentInstance.componentSelected.subscribe((id) => selected.push(id));
    button('Map from “Email”').click();
    expect(selected).toEqual(['fd_email0001']);
  });

  it('shows ✔ when the action is covered', () => {
    render(
      onboardingDefinition({
        actions: [CREATE],
        mappings: [
          { componentId: 'fd_first0001', targetKey: 'customer.person.first_name' },
          { componentId: 'fd_last00001', targetKey: 'customer.person.last_name' },
          { componentId: 'fd_email0001', targetKey: 'customer.primary_email' },
        ],
      }),
    );
    expect(element().textContent).toContain('✔ Ready for Create client');
    expect(element().querySelector('[data-testid="coverage-missing"]')).toBeNull();
  });

  it('offers to remove a mapping whose field was deleted', () => {
    render(
      onboardingDefinition({ mappings: [{ componentId: 'fd_gone00001', targetKey: 'customer.primary_phone' }] }),
    );
    const problems = element().querySelector('[data-testid="coverage-field-problems"]')!;
    expect(problems.textContent).toContain('The mapped field no longer exists.');
    const removed: unknown[] = [];
    fixture.componentInstance.mappingRemoved.subscribe((removal) => removed.push(removal));
    button('Remove mapping').click();
    expect(removed).toEqual([{ mappingComponentId: 'fd_gone00001', rowComponentId: null }]);
  });

  it('links config problems to the action settings', () => {
    render(
      onboardingDefinition({
        actions: [{ ...CREATE, config: { kind: { constant: 'Robot' }, language: { constant: 'En' } } }],
      }),
    );
    const opened: string[] = [];
    fixture.componentInstance.actionSelected.subscribe((key) => opened.push(key));
    button('Open action settings').click();
    expect(opened).toEqual(['create_client']);
  });

  it('shows loading and error states', () => {
    render(onboardingDefinition(), { catalog: null, loading: true });
    expect(element().textContent).toContain('Loading client properties…');
    fixture.componentRef.setInput('loading', false);
    fixture.componentRef.setInput('error', 'Catalog failed.');
    fixture.detectChanges();
    let retried = 0;
    fixture.componentInstance.retry.subscribe(() => retried++);
    button('Try again').click();
    expect(retried).toBe(1);
  });

  it('focuses the requested action once rendered', async () => {
    document.body.appendChild(element());
    render(onboardingDefinition({ actions: [CREATE] }), { focusActionKey: 'create_client' });
    await fixture.whenStable();
    expect(document.activeElement?.getAttribute('data-coverage-action')).toBe('create_client');
    element().remove();
  });

  it('moves focus to an action card', () => {
    render(onboardingDefinition({ actions: [CREATE] }));
    document.body.appendChild(element());
    fixture.componentInstance.focusAction('create_client');
    expect(document.activeElement?.getAttribute('data-coverage-action')).toBe('create_client');
    element().remove();
  });

  it('always offers a way out: removes an orphan row field or an invalid mapping', () => {
    const definition = onboardingDefinition({
      mappings: [
        {
          componentId: 'sc_deps00001',
          targetKey: 'customer.relation.dependents',
          rowFields: { fd_depname1: 'first_name', fd_deplast01: 'last_name', fd_gone00001: 'middle_name' },
        },
        { componentId: 'fd_first0001', targetKey: 'customer.person.first_name' },
      ],
    });
    definition.pages[0].sections[0].components[0].dataClass = 'restricted';
    definition.pages[0].sections[1].components[1].props = { maxLength: 80 };
    render(definition);
    const removed: unknown[] = [];
    fixture.componentInstance.mappingRemoved.subscribe((removal) => removed.push(removal));
    button('Remove from rows').click();
    button('Remove mapping').click();
    expect(removed).toEqual([
      { mappingComponentId: 'sc_deps00001', rowComponentId: 'fd_gone00001' },
      { mappingComponentId: 'fd_first0001', rowComponentId: null },
    ]);
  });

  it('offers removal when a mapped section stops repeating', () => {
    const definition = onboardingDefinition({
      mappings: [
        {
          componentId: 'sc_deps00001',
          targetKey: 'customer.relation.dependents',
          rowFields: { fd_depname1: 'first_name', fd_deplast01: 'last_name' },
        },
      ],
    });
    definition.pages[0].sections[1].repeat = null;
    render(definition);
    expect(element().querySelector('[data-testid="coverage-field-problems"]')?.textContent).toContain('Dependents');
    expect(button('Remove mapping')).toBeTruthy();
  });
});
