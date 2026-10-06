import { TestBed } from '@angular/core/testing';
import { SegmentedComponent } from './segmented.component';

describe('SegmentedComponent', () => {
  it('marca el segmento activo y emite al cambiar', () => {
    TestBed.configureTestingModule({ imports: [SegmentedComponent] });
    const fixture = TestBed.createComponent(SegmentedComponent<string>);
    fixture.componentRef.setInput('options', [
      { id: 'lists', label: 'Lists' },
      { id: 'contacts', label: 'Contacts' },
    ]);
    fixture.componentRef.setInput('value', 'lists');
    fixture.detectChanges();
    const emitted: string[] = [];
    fixture.componentInstance.valueChange.subscribe(v => emitted.push(v));
    const buttons = Array.from(fixture.nativeElement.querySelectorAll('button')) as HTMLButtonElement[];
    expect(buttons[0].classList.contains('bg-white')).toBe(true);
    expect(buttons[0].getAttribute('aria-selected')).toBe('true');
    expect(buttons[1].classList.contains('text-gray-500')).toBe(true);
    buttons[0].click();
    buttons[1].click();
    expect(emitted).toEqual(['contacts']);
  });
});
