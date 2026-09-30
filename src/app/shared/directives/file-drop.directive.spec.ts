import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { FileDropDirective, fileMatchesAccept } from './file-drop.directive';

function file(name: string, type = '', size = 10): File {
  return new File([new Uint8Array(size)], name, { type });
}

function dragEvent(type: string, files: File[] = []): Event {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'dataTransfer', { value: { files, dropEffect: 'none' } });
  return event;
}

@Component({
  imports: [FileDropDirective],
  template: `<div id="zone" appFileDrop #d="appFileDrop" accept=".csv" [multiple]="false"
    (appFileDrop)="dropped = $event" (appFileDropRejected)="rejected = $event"><span id="child">{{ d.dragging() }}</span></div>`,
})
class HostComponent {
  dropped: File[] = [];
  rejected: File[] = [];
}

describe('FileDropDirective', () => {
  it('fileMatchesAccept: extensión, MIME y comodín', () => {
    expect(fileMatchesAccept(file('a.CSV'), '.csv,.xlsx')).toBe(true);
    expect(fileMatchesAccept(file('a.png', 'image/png'), 'image/*')).toBe(true);
    expect(fileMatchesAccept(file('a.pdf', 'application/pdf'), 'application/pdf')).toBe(true);
    expect(fileMatchesAccept(file('a.exe'), '.csv')).toBe(false);
    expect(fileMatchesAccept(file('a.exe'), '')).toBe(true);
  });

  it('arrastrar marca is-dragging y soltar emite aceptados/rechazados', () => {
    TestBed.configureTestingModule({ imports: [HostComponent] });
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    const zone = fixture.nativeElement.querySelector('#zone') as HTMLElement;

    const over = dragEvent('dragover');
    zone.dispatchEvent(over);
    fixture.detectChanges();
    expect(over.defaultPrevented).toBe(true);
    expect(zone.classList.contains('is-dragging')).toBe(true);
    expect(zone.textContent).toContain('true');

    zone.dispatchEvent(dragEvent('drop', [file('a.csv'), file('b.csv'), file('c.exe')]));
    fixture.detectChanges();
    expect(zone.classList.contains('is-dragging')).toBe(false);
    expect(fixture.componentInstance.dropped.map(f => f.name)).toEqual(['a.csv']);
    expect(fixture.componentInstance.rejected.map(f => f.name)).toEqual(['c.exe']);
  });
});
