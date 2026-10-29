import { ComponentFixture, TestBed } from '@angular/core/testing';
import type { FormDefinition, FormMapping } from '@shared/utils/data-collection/form-definition.model';
import { onboardingDefinition, testCatalog } from '../../testing/mapping-catalog.fixture';
import { RepeaterMappingEditorComponent } from './repeater-mapping-editor.component';

const SECTION = 'sc_deps00001';

describe('RepeaterMappingEditorComponent', () => {
  let fixture: ComponentFixture<RepeaterMappingEditorComponent>;
  let emitted: (FormMapping | null)[];

  function render(definition: FormDefinition = onboardingDefinition(), extra: Record<string, unknown> = {}) {
    fixture.componentRef.setInput('definition', definition);
    fixture.componentRef.setInput('sectionId', SECTION);
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

  function values(id: string): string[] {
    return [...select(id).options].map((option) => option.value);
  }

  function mapped(rowFields: Record<string, string>): FormDefinition {
    return onboardingDefinition({
      mappings: [{ componentId: SECTION, targetKey: 'customer.relation.dependents', rowFields }],
    });
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [RepeaterMappingEditorComponent] }).compileComponents();
    fixture = TestBed.createComponent(RepeaterMappingEditorComponent);
    emitted = [];
    fixture.componentInstance.mappingChange.subscribe((value) => emitted.push(value));
  });

  it('offers only collection targets, with labelled controls', () => {
    render();
    for (const id of ['domain', 'entity', 'property'])
      expect(element().querySelector(`label[for="repeater-mapping-${id}-${SECTION}"]`)).not.toBeNull();
    expect(values(`repeater-mapping-entity-${SECTION}`)).toEqual(['Relation']);
    expect(values(`repeater-mapping-property-${SECTION}`)).toEqual(['', 'customer.relation.dependents']);
  });

  it('suggests row fields by label when the list is chosen', () => {
    render();
    choose(`repeater-mapping-property-${SECTION}`, 'customer.relation.dependents');
    expect(emitted).toEqual([
      {
        componentId: SECTION,
        targetKey: 'customer.relation.dependents',
        rowFields: { fd_depname1: 'first_name', fd_deplast01: 'last_name', fd_depdob001: 'date_of_birth' },
      },
    ]);
  });

  it('shows the row fields with compatible components and what is still needed', () => {
    render(mapped({ fd_depname1: 'first_name' }));
    const rows = element().querySelector('[data-testid="row-fields"]')!;
    expect(rows.textContent).toContain('First name');
    expect(rows.textContent).toContain('Still needed: Last name.');
    expect(element().querySelector('[data-testid="repeater-mapping-badges"]')?.textContent).toContain(
      'Used by: Update client profile',
    );
    // Campo de texto: sin el componente ya usado en otra fila ni el de fecha.
    expect(values(`repeater-mapping-row-${SECTION}-2`)).toEqual(['', 'fd_deplast01']);
    expect(values(`repeater-mapping-row-${SECTION}-3`)).toEqual(['', 'fd_depdob001']);
  });

  it('assigns, moves and clears a row field', () => {
    render(mapped({ fd_depname1: 'first_name' }));
    choose(`repeater-mapping-row-${SECTION}-2`, 'fd_deplast01');
    expect(emitted.at(-1)?.rowFields).toEqual({ fd_depname1: 'first_name', fd_deplast01: 'last_name' });

    choose(`repeater-mapping-row-${SECTION}-0`, '');
    expect(emitted.at(-1)?.rowFields).toEqual({});
  });

  it('warns about lengths, auto-matches and removes the mapping', () => {
    render(mapped({ fd_depname1: 'first_name', fd_deplast01: 'last_name' }));
    expect(element().textContent).toContain('All required row fields are mapped.');
    expect(element().querySelector('[data-testid="repeater-mapping-warnings"]')?.textContent).toContain(
      '"Last name" allows 200 characters, but Last name accepts 80.',
    );
    const button = (text: string) =>
      [...element().querySelectorAll('button')].find((item) => item.textContent?.includes(text))!;
    button('Auto-match').click();
    expect(emitted.at(-1)?.rowFields).toEqual({
      fd_depname1: 'first_name',
      fd_deplast01: 'last_name',
      fd_depdob001: 'date_of_birth',
    });
    button('Remove mapping').click();
    expect(emitted.at(-1)).toBeNull();
  });

  it('explains when no collection target is available and shows loading', () => {
    const catalog = testCatalog();
    catalog.targets = catalog.targets.filter((target) => target.dataType !== 'collection');
    render(onboardingDefinition(), { catalog });
    expect(element().querySelector('[data-testid="repeater-mapping-unavailable"]')).not.toBeNull();

    fixture.componentRef.setInput('catalog', null);
    fixture.componentRef.setInput('loading', true);
    fixture.detectChanges();
    expect(element().textContent).toContain('Loading client properties…');
  });
});
