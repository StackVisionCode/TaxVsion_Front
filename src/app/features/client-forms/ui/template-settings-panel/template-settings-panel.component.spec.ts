import { DeferBlockState, TestBed } from '@angular/core/testing';
import { onboardingDefinition, testCatalog } from '../../testing/mapping-catalog.fixture';
import { TemplateSettingsPanelComponent } from './template-settings-panel.component';

describe('TemplateSettingsPanelComponent', () => {
  async function render(panel: 'actions' | 'coverage') {
    await TestBed.configureTestingModule({ imports: [TemplateSettingsPanelComponent] }).compileComponents();
    const fixture = TestBed.createComponent(TemplateSettingsPanelComponent);
    fixture.componentRef.setInput('panel', panel);
    fixture.componentRef.setInput('definition', onboardingDefinition());
    fixture.componentRef.setInput('catalog', testCatalog());
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Loading…');
    for (const block of await fixture.getDeferBlocks()) await block.render(DeferBlockState.Complete);
    return fixture;
  }

  it('loads After submission on demand and forwards its changes', async () => {
    const fixture = await render('actions');
    const emitted: unknown[] = [];
    fixture.componentInstance.actionsChange.subscribe((value) => emitted.push(value));
    const root = fixture.nativeElement as HTMLElement;
    root.querySelector<HTMLButtonElement>('[data-action-type="createCustomer"] [role="switch"]')!.click();
    expect(emitted).toHaveLength(1);
  });

  it('loads Mapping coverage on demand', async () => {
    const fixture = await render('coverage');
    expect((fixture.nativeElement as HTMLElement).querySelector('app-mapping-coverage-panel')).not.toBeNull();
  });
});
