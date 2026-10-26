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

  it('apila las opciones en rejilla con columns para no desbordar', () => {
    TestBed.configureTestingModule({ imports: [SegmentedComponent] });
    const fixture = TestBed.createComponent(SegmentedComponent<string>);
    fixture.componentRef.setInput('options', [
      { id: 'a', label: 'Caption' },
      { id: 'b', label: 'UI' },
      { id: 'c', label: 'Body' },
      { id: 'd', label: 'H3' },
    ]);
    fixture.componentRef.setInput('columns', 3);
    fixture.detectChanges();
    const track = fixture.nativeElement.querySelector('[role="tablist"]') as HTMLElement;
    expect(track.classList.contains('grid')).toBe(true);
    expect(track.style.gridTemplateColumns).toBe('repeat(3, minmax(0, 1fr))');
    expect((fixture.nativeElement as HTMLElement).classList.contains('w-full')).toBe(true);
  });
});

describe('SegmentedComponent keyboard', () => {
  it('moves the selection with the arrow keys and keeps a roving tabindex', () => {
    TestBed.configureTestingModule({ imports: [SegmentedComponent] });
    const fixture = TestBed.createComponent(SegmentedComponent<string>);
    fixture.componentRef.setInput('options', [
      { id: 'a', label: 'A' },
      { id: 'b', label: 'B' },
      { id: 'c', label: 'C' },
    ]);
    fixture.componentRef.setInput('value', 'a');
    fixture.componentRef.setInput('controls', 'panel-1');
    fixture.detectChanges();
    const emitted: string[] = [];
    fixture.componentInstance.valueChange.subscribe((value) => emitted.push(value));
    const track = fixture.nativeElement.querySelector('[role="tablist"]') as HTMLElement;
    const tabs = Array.from(track.querySelectorAll('button')) as HTMLButtonElement[];
    expect(tabs.map((tab) => tab.getAttribute('tabindex'))).toEqual(['0', '-1', '-1']);
    expect(tabs[0].getAttribute('aria-controls')).toBe('panel-1');

    track.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
    track.dispatchEvent(new KeyboardEvent('keydown', { key: 'End' }));
    track.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' }));
    expect(emitted).toEqual(['b', 'c', 'c']);
  });
});
