import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { FormSelectControlComponent } from './form-select-control.component';

describe('FormSelectControlComponent', () => {
  function render(value: string | null, placeholder = 'Select an option'): HTMLSelectElement {
    const fixture = TestBed.createComponent(FormSelectControlComponent);
    fixture.componentRef.setInput('options', [
      { value: 'mapped', label: 'Answered in the form' },
      { value: 'Individual', label: 'Always Individual' },
      { value: 'Business', label: 'Always Business' },
    ]);
    fixture.componentRef.setInput('placeholder', placeholder);
    fixture.componentRef.setInput('value', value);
    fixture.detectChanges();
    return fixture.nativeElement.querySelector('select') as HTMLSelectElement;
  }

  it('shows the stored value even though the options render after the select', () => {
    const select = render('Individual', '');

    expect(select.value).toBe('Individual');
    expect(select.options[select.selectedIndex].text).toBe('Always Individual');
  });

  it('falls back to the placeholder when there is no value', () => {
    const select = render(null);

    expect(select.value).toBe('');
  });
});
