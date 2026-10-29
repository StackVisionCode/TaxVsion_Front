import { ComponentFixture, TestBed } from '@angular/core/testing';
import { onboardingDefinition } from '../../testing/mapping-catalog.fixture';
import type { ComponentOption } from '../../utils/mapping-compatibility';
import { OptionListEditorComponent } from './option-list-editor.component';

const OPTIONS: ComponentOption[] = [
  { value: 'spanish', label: 'Spanish' },
  { value: 'en', label: 'English' },
  { value: 'option7', label: 'Other' },
];

const MAPPED = () =>
  onboardingDefinition({
    mappings: [{ componentId: 'fd_lang00001', targetKey: 'customer.language', optionMap: { spanish: 'Es' } }],
  });

describe('OptionListEditorComponent', () => {
  let fixture: ComponentFixture<OptionListEditorComponent>;
  let changes: ComponentOption[][];
  let cleared: string[];

  function render(extra: Record<string, unknown> = {}) {
    fixture.componentRef.setInput('options', OPTIONS);
    fixture.componentRef.setInput('componentId', 'fd_lang00001');
    for (const [key, value] of Object.entries(extra)) fixture.componentRef.setInput(key, value);
    fixture.detectChanges();
  }

  const root = () => fixture.nativeElement as HTMLElement;
  const byLabel = (label: string) => root().querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!;
  const byText = (text: string) =>
    [...root().querySelectorAll('button')].find((item) => item.textContent?.trim() === text);

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [OptionListEditorComponent] }).compileComponents();
    fixture = TestBed.createComponent(OptionListEditorComponent);
    changes = [];
    cleared = [];
    fixture.componentInstance.optionsChange.subscribe((value) => changes.push(value));
    fixture.componentInstance.optionMapCleared.subscribe((value) => cleared.push(value));
  });

  it('keeps values stable when renaming and reordering', () => {
    render();
    const input = root().querySelector<HTMLInputElement>('[aria-label="Option 2 label"]')!;
    input.value = 'British English';
    input.dispatchEvent(new Event('input'));
    expect(changes.at(-1)?.[1]).toEqual({ value: 'en', label: 'British English' });

    byLabel('Move option 1 down').click();
    expect(changes.at(-1)?.map((option) => option.value)).toEqual(['en', 'spanish', 'option7']);
    expect(byLabel('Move option 1 up').disabled).toBe(true);
  });

  it('adds an option with a value that does not collide', () => {
    render();
    byText('Add option')!.click();
    expect(changes.at(-1)?.at(-1)).toEqual({ value: 'option8', label: 'Option 4' });
  });

  it('removes an unused option at once', () => {
    render();
    byLabel('Remove option 3').click();
    expect(changes.at(-1)?.map((option) => option.value)).toEqual(['spanish', 'en']);
    expect(cleared).toEqual([]);
  });

  it('asks before removing a mapped option and clears it from the option map', () => {
    render({ definition: MAPPED(), canEditMapping: true });
    byLabel('Remove option 1').click();
    fixture.detectChanges();
    expect(changes).toEqual([]);
    expect(root().querySelector('[data-testid="option-removal"]')?.textContent).toContain('the data mapping');
    byText('Remove option')!.click();
    expect(changes.at(-1)?.map((option) => option.value)).toEqual(['en', 'option7']);
    expect(cleared).toEqual(['spanish']);
  });

  it('blocks removing a mapped option without the configure permission', () => {
    render({ definition: MAPPED(), canEditMapping: false });
    byLabel('Remove option 1').click();
    fixture.detectChanges();
    expect(root().textContent).toContain('Ask someone with Configure actions');
    expect(byText('Remove option')).toBeUndefined();
    byText('OK')!.click();
    expect(changes).toEqual([]);
  });
});
