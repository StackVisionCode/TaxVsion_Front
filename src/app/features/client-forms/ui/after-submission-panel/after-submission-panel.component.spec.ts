import { ComponentFixture, TestBed } from '@angular/core/testing';
import type { FormAction, FormDefinition } from '@shared/utils/data-collection/form-definition.model';
import { onboardingDefinition, testCatalog } from '../../testing/mapping-catalog.fixture';
import { AfterSubmissionPanelComponent } from './after-submission-panel.component';

const CREATE: FormAction = {
  key: 'create_client',
  type: 'createCustomer',
  trigger: 'onSubmit',
  config: { kind: { constant: 'Individual' }, language: { mapped: true }, waitFor: 'none' },
};

describe('AfterSubmissionPanelComponent', () => {
  let fixture: ComponentFixture<AfterSubmissionPanelComponent>;
  let emitted: FormAction[][];

  function render(definition: FormDefinition, extra: Record<string, unknown> = {}) {
    fixture.componentRef.setInput('definition', definition);
    fixture.componentRef.setInput('catalog', testCatalog());
    for (const [key, value] of Object.entries(extra)) fixture.componentRef.setInput(key, value);
    fixture.detectChanges();
  }

  function card(type: string): HTMLElement {
    const found = (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>(`[data-action-type="${type}"]`);
    if (!found) throw new Error(`Missing card ${type}`);
    return found;
  }

  function toggle(type: string): HTMLButtonElement {
    return card(type).querySelector<HTMLButtonElement>('[role="switch"]')!;
  }

  function choose(id: string, value: string): void {
    const control = (fixture.nativeElement as HTMLElement).querySelector<HTMLSelectElement>(`#${id}`)!;
    control.value = value;
    control.dispatchEvent(new Event('change'));
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [AfterSubmissionPanelComponent] }).compileComponents();
    fixture = TestBed.createComponent(AfterSubmissionPanelComponent);
    emitted = [];
    fixture.componentInstance.actionsChange.subscribe((actions) => emitted.push(actions));
  });

  it('renders the closed catalog with implicit and coming soon actions', () => {
    render(onboardingDefinition());
    expect(card('notifyStaff').textContent).toContain('Always on');
    expect(card('notifyStaff').querySelector('[role="switch"]')).toBeNull();
    expect(card('requestSignature').textContent).toContain('Coming soon');
    expect(toggle('requestSignature').disabled).toBe(true);
    expect(toggle('generateSummary').disabled).toBe(true);
    expect(toggle('createCustomer').disabled).toBe(false);
    expect(toggle('createCustomer').getAttribute('aria-label')).toBe('Turn on Create client');
  });

  it('adds Create client with the default automatic configuration', () => {
    render(onboardingDefinition());
    toggle('createCustomer').click();
    expect(emitted).toEqual([[CREATE]]);
  });

  it('defaults to manual creation and disables Automatic when the office turned it off', () => {
    render(onboardingDefinition(), { autoCustomerCreationEnabled: false });
    toggle('createCustomer').click();
    expect(emitted[0][0].trigger).toBe('manual');

    render(onboardingDefinition({ actions: [{ ...CREATE, trigger: 'manual' }] }), {
      autoCustomerCreationEnabled: false,
    });
    expect(card('createCustomer').querySelector('[data-testid="auto-off"]')).not.toBeNull();
    const automatic = card('createCustomer').querySelector<HTMLInputElement>('input[value="onSubmit"]')!;
    expect(automatic.disabled).toBe(true);
  });

  it('blocks actions outside the office plan or without permission', () => {
    render(onboardingDefinition(), { modules: new Set(['planner']) });
    expect(card('createCustomer').querySelector('[data-testid="action-blocked"]')?.textContent).toContain(
      "office plan doesn't include",
    );
    expect(toggle('createCustomer').disabled).toBe(true);

    const catalog = testCatalog();
    catalog.operations = [];
    render(onboardingDefinition(), { catalog, modules: null });
    expect(card('createCustomer').textContent).toContain("You don't have permission to configure this action.");
    expect(toggle('createCustomer').disabled).toBe(true);
  });

  it('shows missing mappings and links to the coverage', () => {
    render(onboardingDefinition({ actions: [CREATE] }));
    const missing = card('createCustomer').querySelector('[data-testid="action-missing"]')!;
    expect(missing.textContent).toContain('First name (Individual)');
    expect(missing.textContent).toContain('Preferred language');
    const requested: string[] = [];
    fixture.componentInstance.coverageRequested.subscribe((key) => requested.push(key));
    missing.querySelector('button')!.click();
    expect(requested).toEqual(['create_client']);
  });

  it('shows ready when the mapping coverage is complete', () => {
    render(
      onboardingDefinition({
        actions: [{ ...CREATE, config: { kind: { constant: 'Individual' }, language: { constant: 'En' } } }],
        mappings: [
          { componentId: 'fd_first0001', targetKey: 'customer.person.first_name' },
          { componentId: 'fd_last00001', targetKey: 'customer.person.last_name' },
          { componentId: 'fd_email0001', targetKey: 'customer.primary_email' },
        ],
      }),
    );
    expect(card('createCustomer').querySelector('[data-testid="action-ready"]')?.textContent).toContain(
      '✔ Ready for Create client',
    );
  });

  it('edits the trigger and the Create client options', () => {
    render(onboardingDefinition({ actions: [CREATE] }));
    const manual = card('createCustomer').querySelector<HTMLInputElement>('input[value="manual"]')!;
    manual.click();
    expect(emitted.at(-1)?.[0].trigger).toBe('manual');

    choose('action-config-create_client-kind', '__mapped');
    expect(emitted.at(-1)?.[0].config?.['kind']).toEqual({ mapped: true });

    choose('action-config-create_client-language', 'Es');
    expect(emitted.at(-1)?.[0].config?.['language']).toEqual({ constant: 'Es' });

    const address = card('createCustomer').querySelector<HTMLInputElement>('#action-config-create_client-address')!;
    address.click();
    expect(emitted.at(-1)?.[0].config?.['postCreate']).toEqual(['primaryAddress']);

    const wait = card('createCustomer').querySelector<HTMLInputElement>('#action-config-create_client-wait')!;
    expect(wait.disabled).toBe(true);
  });

  it('lets existing unavailable actions be turned off, except the one tied to the signature step', () => {
    const definition = onboardingDefinition({
      actions: [
        { key: 'summary', type: 'generateSummary', trigger: 'onComplete' },
        { key: 'sign', type: 'requestSignature', trigger: 'onSubmit' },
      ],
    });
    definition.pages[0].sections[0].components.push({ id: 'fd_sign00001', type: 'signatureStep' });
    render(definition);
    expect(toggle('requestSignature').disabled).toBe(true);
    expect(card('requestSignature').textContent).toContain('Added with the signature step');

    toggle('generateSummary').click();
    expect(emitted).toEqual([[{ key: 'sign', type: 'requestSignature', trigger: 'onSubmit' }]]);
  });

  it('explains when the office turned signature steps off', () => {
    render(onboardingDefinition(), { signatureStepEnabled: false });
    expect(card('requestSignature').querySelector('[data-testid="signature-off"]')).not.toBeNull();
    expect(toggle('requestSignature').disabled).toBe(true);
  });

  it('turns off Create client and respects the disabled input', () => {
    render(onboardingDefinition({ actions: [CREATE] }));
    toggle('createCustomer').click();
    expect(emitted).toEqual([[]]);

    fixture.componentRef.setInput('disabled', true);
    fixture.detectChanges();
    expect(toggle('createCustomer').disabled).toBe(true);
  });

  it('maps the client kind by default when a field already feeds it', () => {
    render(
      onboardingDefinition({
        mappings: [
          { componentId: 'fd_lang00001', targetKey: 'customer.kind', optionMap: { spanish: 'Individual', en: 'Business' } },
        ],
      }),
    );
    toggle('createCustomer').click();
    expect(emitted[0][0].config?.['kind']).toEqual({ mapped: true });
  });

  it('lets old drafts drop implicit actions', () => {
    render(
      onboardingDefinition({
        actions: [{ key: 'notify', type: 'notifyStaff', trigger: 'onSubmit' }, CREATE],
      }),
    );
    const legacy = card('notifyStaff').querySelector('[data-testid="legacy-action"]')!;
    expect(legacy.textContent).toContain('old');
    legacy.querySelector('button')!.click();
    expect(emitted).toEqual([[CREATE]]);
  });
});
