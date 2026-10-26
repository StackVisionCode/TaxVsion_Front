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
});
