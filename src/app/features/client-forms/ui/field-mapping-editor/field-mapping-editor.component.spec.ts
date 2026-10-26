import { ComponentFixture, TestBed } from '@angular/core/testing';
import type { FormDefinition, FormMapping } from '@shared/utils/data-collection/form-definition.model';
import { onboardingDefinition, testCatalog } from '../../testing/mapping-catalog.fixture';
import { FieldMappingEditorComponent } from './field-mapping-editor.component';

describe('FieldMappingEditorComponent', () => {
  let fixture: ComponentFixture<FieldMappingEditorComponent>;
  let emitted: (FormMapping | null)[];

  function render(componentId: string, definition: FormDefinition = onboardingDefinition(), extra: Record<string, unknown> = {}) {
    fixture.componentRef.setInput('definition', definition);
    fixture.componentRef.setInput('componentId', componentId);
    fixture.componentRef.setInput('catalog', testCatalog());
    for (const [key, value] of Object.entries(extra)) fixture.componentRef.setInput(key, value);
    fixture.detectChanges();
  }

  function element(): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  function select(id: string): HTMLSelectElement {
    const found = element().querySelector<HTMLSelectElement>(`#${id}`);
    if (!found) throw new Error(`Missing select ${id}`);
    return found;
  }

  function choose(id: string, value: string): void {
    const control = select(id);
    control.value = value;
    control.dispatchEvent(new Event('change'));
  }

  function optionValues(id: string): string[] {
    return [...select(id).options].map((option) => option.value);
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [FieldMappingEditorComponent] }).compileComponents();
    fixture = TestBed.createComponent(FieldMappingEditorComponent);
    emitted = [];
    fixture.componentInstance.mappingChange.subscribe((value) => emitted.push(value));
  });

  it('shows loading and error states with a retry', () => {
    render('fd_first0001', onboardingDefinition(), { catalog: null, loading: true });
    expect(element().textContent).toContain('Loading client properties…');

    let retried = 0;
    fixture.componentInstance.retry.subscribe(() => retried++);
    fixture.componentRef.setInput('loading', false);
    fixture.componentRef.setInput('error', 'The client data catalog could not be loaded.');
    fixture.detectChanges();
    expect(element().querySelector('[role="alert"]')?.textContent).toContain('could not be loaded');
    element().querySelector<HTMLButtonElement>('[role="alert"] button')!.click();
    expect(retried).toBe(1);
  });

  it('explains fields that cannot be mapped', () => {
    render('fd_file00001');
    expect(element().querySelector('[data-testid="mapping-unavailable"]')?.textContent).toContain(
      "This field type can't be mapped",
    );
    render('fd_depname1');
    expect(element().textContent).toContain('repeating section');
  });

  it('offers Domain → Entity → Property with labelled controls and compatible properties only', () => {
    render('fd_first0001');
    for (const id of ['mapping-domain-fd_first0001', 'mapping-entity-fd_first0001', 'mapping-property-fd_first0001'])
      expect(element().querySelector(`label[for="${id}"]`)).not.toBeNull();
    expect(optionValues('mapping-domain-fd_first0001')).toEqual(['Customer']);
    expect(optionValues('mapping-entity-fd_first0001')).toEqual(['Customer']);
    expect(optionValues('mapping-property-fd_first0001')).toEqual([
      '',
      'customer.person.first_name',
      'customer.person.last_name',
      'customer.business.legal_name',
    ]);
  });

  it('emits a new mapping when a property is chosen', () => {
    render('fd_first0001');
    choose('mapping-property-fd_first0001', 'customer.person.first_name');
    expect(emitted).toEqual([
      { componentId: 'fd_first0001', targetKey: 'customer.person.first_name', transform: 'trim' },
    ]);
    choose('mapping-property-fd_first0001', '');
    expect(emitted.at(-1)).toBeNull();
  });

  it('hides properties already mapped from other fields', () => {
    render(
      'fd_first0001',
      onboardingDefinition({
        mappings: [{ componentId: 'fd_last00001', targetKey: 'customer.person.last_name' }],
      }),
    );
    expect(optionValues('mapping-property-fd_first0001')).not.toContain('customer.person.last_name');
    expect(element().textContent).toContain('1 property is already');
  });

  it('shows requirement and limit badges, warnings and the transform for a mapped field', () => {
    const definition = onboardingDefinition({
      mappings: [{ componentId: 'fd_notes0001', targetKey: 'customer.person.first_name', transform: 'trim' }],
    });
    render('fd_notes0001', definition);
    const badges = element().querySelector('[data-testid="mapping-badges"]')!.textContent!;
    expect(badges).toContain('Required for: Create client (Individual)');
    expect(badges).toContain('Max 80 characters');
    expect(element().querySelector('[data-testid="mapping-warnings"]')?.textContent).toContain(
      'accepts 80',
    );
    choose('mapping-transform-fd_notes0001', 'uppercase');
    expect(emitted.at(-1)).toMatchObject({ transform: 'uppercase' });
  });

  it('edits the option map of an enum target', () => {
    const definition = onboardingDefinition({
      mappings: [{ componentId: 'fd_lang00001', targetKey: 'customer.language', optionMap: { en: 'En' } }],
    });
    render('fd_lang00001', definition);
    const editor = element().querySelector('[data-testid="option-map"]')!;
    expect(editor.textContent).toContain('Every option needs a client value.');
    expect(optionValues('mapping-option-fd_lang00001-0')).toEqual(['', 'Es', 'En', 'Pt', 'Fr']);

    choose('mapping-option-fd_lang00001-0', 'Es');
    expect(emitted.at(-1)?.optionMap).toEqual({ en: 'En', spanish: 'Es' });

    choose('mapping-option-fd_lang00001-1', '');
    expect(emitted.at(-1)?.optionMap).toEqual({});

    const autoMatch = [...editor.querySelectorAll('button')].find((button) => button.textContent?.includes('Auto-match'))!;
    autoMatch.click();
    expect(emitted.at(-1)?.optionMap).toEqual({ en: 'En' });
  });

  it('removes the mapping and respects the disabled state', () => {
    const definition = onboardingDefinition({
      mappings: [{ componentId: 'fd_email0001', targetKey: 'customer.primary_email' }],
    });
    render('fd_email0001', definition);
    const remove = [...element().querySelectorAll('button')].find((button) => button.textContent?.includes('Remove mapping'))!;
    remove.click();
    expect(emitted).toEqual([null]);

    fixture.componentRef.setInput('disabled', true);
    fixture.detectChanges();
    expect(select('mapping-property-fd_email0001').disabled).toBe(true);
    expect(remove.disabled).toBe(true);
  });

  it('offers Remove mapping when the mapped field moved into a repeater or the target is gone', () => {
    const moved = onboardingDefinition({
      mappings: [{ componentId: 'fd_depname1', targetKey: 'customer.person.first_name' }],
    });
    render('fd_depname1', moved);
    expect(element().querySelector('[data-testid="mapping-orphan"]')?.textContent).toContain('repeating section');
    [...element().querySelectorAll('button')].find((item) => item.textContent?.includes('Remove mapping'))!.click();
    expect(emitted).toEqual([null]);

    const unknown = onboardingDefinition({
      mappings: [{ componentId: 'fd_email0001', targetKey: 'customer.fiscal.tax_identifier' }],
    });
    render('fd_email0001', unknown);
    expect(element().querySelector('[data-testid="mapping-orphan"]')?.textContent).toContain("isn't available");
  });

  it('flags a field that became restricted and fixes past-only dates in one click', () => {
    const restricted = onboardingDefinition({
      mappings: [{ componentId: 'fd_first0001', targetKey: 'customer.person.first_name' }],
    });
    restricted.pages[0].sections[0].components[0].dataClass = 'restricted';
    render('fd_first0001', restricted);
    expect(element().querySelector('[data-testid="mapping-orphan"]')?.textContent).toContain('no longer fits');

    const dated = onboardingDefinition({
      mappings: [{ componentId: 'fd_date00001', targetKey: 'customer.business.formation_date' }],
    });
    dated.pages[0].sections[0].components.push({ id: 'fd_date00001', type: 'date', label: 'Founded', props: {} });
    const patches: unknown[] = [];
    fixture.componentInstance.componentPatch.subscribe((value) => patches.push(value));
    render('fd_date00001', dated);
    [...element().querySelectorAll('button')].find((item) => item.textContent?.includes('Use today'))!.click();
    expect(patches).toEqual([{ props: { max: 'today' } }]);
  });

  it('asks to make the field required only when a configured action needs it', () => {
    const definition = onboardingDefinition({
      mappings: [{ componentId: 'fd_notes0001', targetKey: 'customer.person.first_name' }],
    });
    render('fd_notes0001', definition);
    expect(element().textContent).not.toContain('Make required');

    const withAction = onboardingDefinition({
      mappings: [{ componentId: 'fd_notes0001', targetKey: 'customer.person.first_name' }],
      actions: [
        { key: 'create_client', type: 'createCustomer', trigger: 'onSubmit', config: { kind: { constant: 'Individual' } } },
      ],
    });
    const patches: unknown[] = [];
    fixture.componentInstance.componentPatch.subscribe((value) => patches.push(value));
    render('fd_notes0001', withAction);
    [...element().querySelectorAll('button')].find((item) => item.textContent?.includes('Make required'))!.click();
    expect(patches).toEqual([{ required: true }]);

    // Con el Kind fijo en Business, el nombre de persona no es requerido.
    const business = onboardingDefinition({
      mappings: [{ componentId: 'fd_notes0001', targetKey: 'customer.person.first_name' }],
      actions: [
        { key: 'create_client', type: 'createCustomer', trigger: 'onSubmit', config: { kind: { constant: 'Business' } } },
      ],
    });
    render('fd_notes0001', business);
    expect(element().textContent).not.toContain('Make required');
  });
});
