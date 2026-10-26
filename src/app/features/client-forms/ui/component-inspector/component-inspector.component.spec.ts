import { DeferBlockState, TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { ComponentInspectorComponent } from './component-inspector.component';
import { onboardingDefinition, testCatalog } from '../../testing/mapping-catalog.fixture';

describe('ComponentInspectorComponent', () => {
  it('prevents lowering the minimum data classification', async () => {
    await TestBed.configureTestingModule({ imports: [ComponentInspectorComponent] }).compileComponents();
    const fixture = TestBed.createComponent(ComponentInspectorComponent);
    fixture.componentInstance.component = { id: 'fd_abcdefghij', type: 'taxId', label: 'Tax ID', dataClass: 'restricted', props: { kinds: ['ssn'] } };
    fixture.detectChanges();
    const select = [...fixture.nativeElement.querySelectorAll('select')].find((item: HTMLSelectElement) =>
      [...item.options].some(option => option.value === 'restricted'),
    ) as HTMLSelectElement;
    expect(select).toBeTruthy();
    expect([...select.options].map(option => option.value)).toEqual(['restricted']);
  });
});

describe('ComponentInspectorComponent mapping tab', () => {
  async function render(component: { id: string; type: string; label?: string }, canMap: boolean) {
    await TestBed.configureTestingModule({ imports: [ComponentInspectorComponent] }).compileComponents();
    const fixture = TestBed.createComponent(ComponentInspectorComponent);
    const definition = onboardingDefinition();
    fixture.componentInstance.component = component;
    fixture.componentInstance.definition = definition;
    fixture.componentInstance.mappingCatalog = testCatalog();
    fixture.componentInstance.canMap = canMap;
    fixture.detectChanges();
    return fixture;
  }

  const tabs = (root: HTMLElement) => [...root.querySelectorAll('[role="tab"]')].map((item) => item.textContent?.trim());

  it('shows Mapping for input fields only when allowed', async () => {
    const allowed = await render({ id: 'fd_first0001', type: 'text', label: 'First name' }, true);
    expect(tabs(allowed.nativeElement)).toContain('Mapping');
    TestBed.resetTestingModule();
    const denied = await render({ id: 'fd_first0001', type: 'text', label: 'First name' }, false);
    expect(tabs(denied.nativeElement)).not.toContain('Mapping');
    TestBed.resetTestingModule();
    const layout = await render({ id: 'fd_head00001', type: 'heading' }, true);
    expect(tabs(layout.nativeElement)).not.toContain('Mapping');
  });

  it('opens the mapping editor and forwards its changes', async () => {
    const fixture = await render({ id: 'fd_email0001', type: 'email', label: 'Email' }, true);
    const emitted: unknown[] = [];
    fixture.componentInstance.mappingChange.subscribe((value) => emitted.push(value));
    fixture.componentInstance.preferredTab = 'mapping';
    fixture.detectChanges();
    // El editor está en un @defer: se fuerza a completo.
    for (const block of await fixture.getDeferBlocks()) await block.render(DeferBlockState.Complete);
    const root = fixture.nativeElement as HTMLElement;
    const property = root.querySelector<HTMLSelectElement>('#mapping-property-fd_email0001')!;
    property.value = 'customer.primary_email';
    property.dispatchEvent(new Event('change'));
    expect(emitted).toEqual([{ componentId: 'fd_email0001', targetKey: 'customer.primary_email', transform: 'trim' }]);
  });
});

describe('ComponentInspectorComponent read-only and dates', () => {
  it('keeps the tabs usable while editing is paused', async () => {
    await TestBed.configureTestingModule({ imports: [ComponentInspectorComponent] }).compileComponents();
    const fixture = TestBed.createComponent(ComponentInspectorComponent);
    fixture.componentInstance.component = { id: 'fd_first0001', type: 'text', label: 'First name' };
    fixture.componentInstance.disabled = true;
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    const display = [...root.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find(
      (item) => item.textContent?.trim() === 'Display',
    )!;
    expect(display.closest('[inert]')).toBeNull();
    display.click();
    fixture.detectChanges();
    expect(fixture.componentInstance.activeTab()).toBe('display');
    expect(root.querySelector('fieldset[data-builder-inspector]')?.hasAttribute('inert')).toBe(true);
    expect(root.querySelector<HTMLButtonElement>('[aria-label="Delete component"]')!.disabled).toBe(true);
  });

  it('sets a date bound to today', async () => {
    await TestBed.configureTestingModule({ imports: [ComponentInspectorComponent] }).compileComponents();
    const fixture = TestBed.createComponent(ComponentInspectorComponent);
    fixture.componentInstance.component = { id: 'fd_date00001', type: 'date', label: 'Founded', props: {} };
    const patches: unknown[] = [];
    fixture.componentInstance.componentChange.subscribe((value) => patches.push(value));
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    const today = [...root.querySelectorAll('label')].find((item) =>
      item.textContent?.includes('Latest date is today'),
    )!;
    today.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click();
    expect(patches.at(-1)).toEqual({ props: { max: 'today' } });
  });
});
