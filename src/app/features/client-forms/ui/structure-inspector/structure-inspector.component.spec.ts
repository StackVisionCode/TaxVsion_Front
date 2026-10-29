import { DeferBlockState, TestBed } from '@angular/core/testing';
import type { FormMapping } from '@shared/utils/data-collection/form-definition.model';
import { onboardingDefinition, testCatalog } from '../../testing/mapping-catalog.fixture';
import { StructureInspectorComponent } from './structure-inspector.component';

describe('StructureInspectorComponent repeater mapping', () => {
  async function render(sectionIndex: number, canMap: boolean) {
    await TestBed.configureTestingModule({ imports: [StructureInspectorComponent] }).compileComponents();
    const fixture = TestBed.createComponent(StructureInspectorComponent);
    const definition = onboardingDefinition();
    fixture.componentInstance.section = definition.pages[0].sections[sectionIndex];
    fixture.componentInstance.definition = definition;
    fixture.componentInstance.canMap = canMap;
    fixture.componentInstance.mappingCatalog = testCatalog();
    fixture.detectChanges();
    // El editor del repeater está en un @defer: se fuerza a completo.
    for (const block of await fixture.getDeferBlocks()) await block.render(DeferBlockState.Complete);
    return fixture;
  }

  it('shows the data mapping of a repeater with the configure permission', async () => {
    const fixture = await render(1, true);
    const emitted: (FormMapping | null)[] = [];
    fixture.componentInstance.mappingChange.subscribe((value) => emitted.push(value));
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('[data-testid="structure-mapping"] app-repeater-mapping-editor')).not.toBeNull();

    const property = root.querySelector<HTMLSelectElement>('#repeater-mapping-property-sc_deps00001')!;
    property.value = 'customer.relation.dependents';
    property.dispatchEvent(new Event('change'));
    expect(emitted[0]?.targetKey).toBe('customer.relation.dependents');
  });

  it('hides it without the permission or for a regular section', async () => {
    const hidden = await render(1, false);
    expect((hidden.nativeElement as HTMLElement).querySelector('[data-testid="structure-mapping"]')).toBeNull();
    TestBed.resetTestingModule();
    const regular = await render(0, true);
    expect((regular.nativeElement as HTMLElement).querySelector('[data-testid="structure-mapping"]')).toBeNull();
  });
});
