import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { ConditionEditorComponent } from './condition-editor.component';

describe('ConditionEditorComponent', () => {
  it('offers only the supplied earlier fields', async () => {
    await TestBed.configureTestingModule({ imports: [ConditionEditorComponent] }).compileComponents();
    const fixture = TestBed.createComponent(ConditionEditorComponent);
    fixture.componentInstance.condition = { field: null, op: 'isAnswered' };
    fixture.componentInstance.fields = [{ id: 'fd_abcdefghij', type: 'text', label: 'Earlier', props: {} }];
    fixture.detectChanges();
    const options = [...fixture.nativeElement.querySelectorAll('select')[0].options].map((item: HTMLOptionElement) => item.text);
    expect(options).toContain('Earlier');
  });

  it('explains instead of offering an empty list when nothing is above the item', async () => {
    await TestBed.configureTestingModule({ imports: [ConditionEditorComponent] }).compileComponents();
    const fixture = TestBed.createComponent(ConditionEditorComponent);
    fixture.componentInstance.fields = [];
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;

    expect(root.querySelector('[data-role="condition-empty"]')?.textContent).toContain('no questions above this item');
    expect(root.querySelector<HTMLInputElement>('[data-role="condition-toggle"] input')?.disabled).toBe(true);
  });

  it('still lets an existing rule be turned off when its fields are gone', async () => {
    await TestBed.configureTestingModule({ imports: [ConditionEditorComponent] }).compileComponents();
    const fixture = TestBed.createComponent(ConditionEditorComponent);
    fixture.componentInstance.fields = [];
    fixture.componentInstance.condition = { all: [{ field: null, op: 'isAnswered' }] };
    fixture.detectChanges();
    const toggle = (fixture.nativeElement as HTMLElement).querySelector<HTMLInputElement>('[data-role="condition-toggle"] input');

    expect(toggle?.disabled).toBe(false);
  });
});
