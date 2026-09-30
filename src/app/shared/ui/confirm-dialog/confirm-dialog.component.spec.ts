import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ConfirmDialogComponent } from './confirm-dialog.component';

@Component({
  imports: [ConfirmDialogComponent],
  template: `
    <app-confirm-dialog [isOpen]="true" heading="Delete?" message="Gone forever" [tone]="tone()" [busy]="busy()"
      busyLabel="Deleting…" (confirmed)="confirms = confirms + 1" (cancelled)="cancels = cancels + 1">
      @if (extra()) {
        <label id="extra">Also remove files</label>
      }
    </app-confirm-dialog>
  `,
})
class HostComponent {
  readonly tone = signal<'danger' | 'primary'>('danger');
  readonly busy = signal(false);
  readonly extra = signal(false);
  confirms = 0;
  cancels = 0;
}

describe('ConfirmDialogComponent', () => {
  function setup() {
    TestBed.configureTestingModule({ imports: [HostComponent] });
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const buttons = () => Array.from(el.querySelectorAll('.mt-6 button')) as HTMLButtonElement[];
    return { fixture, host: fixture.componentInstance, el, buttons };
  }

  afterEach(() => {
    document.body.style.overflow = '';
  });

  it('por defecto: rojo, Cancel/Delete y emite', () => {
    const { host, el, buttons } = setup();
    const [cancel, confirm] = buttons();
    expect(cancel.textContent?.trim()).toBe('Cancel');
    expect(confirm.textContent?.trim()).toBe('Delete');
    expect(confirm.classList.contains('bg-red-500')).toBe(true);
    expect((el.querySelector('.mt-4 ion-icon') as unknown as { name: string }).name).toBe('alert-outline');
    confirm.click();
    cancel.click();
    expect(host.confirms).toBe(1);
    expect(host.cancels).toBe(1);
  });

  it('tone primary usa el botón brand', () => {
    const { fixture, host, buttons } = setup();
    host.tone.set('primary');
    fixture.detectChanges();
    expect(buttons()[1].classList.contains('bg-brand-bold')).toBe(true);
    expect(buttons()[1].classList.contains('bg-red-500')).toBe(false);
  });

  it('busy deshabilita y no emite', () => {
    const { fixture, host, buttons } = setup();
    host.busy.set(true);
    fixture.detectChanges();
    const [cancel, confirm] = buttons();
    expect(confirm.disabled).toBe(true);
    expect(confirm.textContent?.trim()).toBe('Deleting…');
    fixture.componentInstance.cancels = 0;
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(cancel.disabled).toBe(true);
    expect(host.cancels).toBe(0);
  });

  it('proyecta contenido extra', () => {
    const { fixture, host, el } = setup();
    host.extra.set(true);
    fixture.detectChanges();
    expect(el.querySelector('#extra')).toBeTruthy();
  });
});
