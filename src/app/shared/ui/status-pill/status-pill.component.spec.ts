import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { StatusPillComponent, StatusTone } from './status-pill.component';

@Component({
  imports: [StatusPillComponent],
  template: `<app-status-pill [tone]="tone()" [dot]="dot()" [soft]="soft()" [size]="size()">Active</app-status-pill>`,
})
class HostComponent {
  readonly tone = signal<StatusTone>('success');
  readonly dot = signal(true);
  readonly soft = signal(false);
  readonly size = signal<'sm' | 'xs'>('sm');
}

describe('StatusPillComponent', () => {
  function setup() {
    TestBed.configureTestingModule({ imports: [HostComponent] });
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    const pill = () => fixture.nativeElement.querySelector('app-status-pill > span') as HTMLElement;
    return { fixture, host: fixture.componentInstance, pill };
  }

  it('pinta el tono con punto y etiqueta', () => {
    const { pill } = setup();
    expect(pill().className).toContain('border-emerald-200 text-emerald-600');
    expect(pill().className).toContain('px-3 py-0.5 text-xs');
    expect(pill().querySelector('.bg-emerald-500')).toBeTruthy();
    expect(pill().textContent?.trim()).toBe('Active');
  });

  it('soft, sin punto y tamaño xs', () => {
    const { fixture, host, pill } = setup();
    host.soft.set(true);
    host.dot.set(false);
    host.size.set('xs');
    host.tone.set('danger');
    fixture.detectChanges();
    expect(pill().className).toContain('bg-red-50');
    expect(pill().className).toContain('text-[10px]');
    expect(pill().querySelector('.rounded-full')).toBeNull();
  });
});
