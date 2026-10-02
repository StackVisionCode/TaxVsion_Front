import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { StateBlockComponent } from './state-block.component';

@Component({
  imports: [StateBlockComponent],
  template: `
    <app-state-block [loading]="loading()" [error]="error()" [empty]="empty()" emptyTitle="No rows"
      emptyMessage="Add one" [showRetry]="showRetry()" (retry)="retries = retries + 1">
      <p id="content">content</p>
    </app-state-block>
  `,
})
class HostComponent {
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly empty = signal(false);
  readonly showRetry = signal(true);
  retries = 0;
}

describe('StateBlockComponent', () => {
  function setup() {
    TestBed.configureTestingModule({ imports: [HostComponent] });
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    return { fixture, host: fixture.componentInstance, el: fixture.nativeElement as HTMLElement };
  }

  it('sin estados muestra el contenido proyectado', () => {
    const { el } = setup();
    expect(el.querySelector('#content')).toBeTruthy();
  });

  it('loading tiene prioridad', () => {
    const { fixture, host, el } = setup();
    host.loading.set(true);
    host.error.set('boom');
    fixture.detectChanges();
    expect(el.textContent).toContain('Loading…');
    expect(el.querySelector('#content')).toBeNull();
    expect(el.textContent).not.toContain('boom');
  });

  it('error con Retry', () => {
    const { fixture, host, el } = setup();
    host.error.set('Could not load');
    fixture.detectChanges();
    const p = el.querySelector('p.text-red-600')!;
    expect(p.textContent).toContain('Could not load');
    (el.querySelector('button') as HTMLButtonElement).click();
    expect(host.retries).toBe(1);

    host.showRetry.set(false);
    fixture.detectChanges();
    expect(el.querySelector('button')).toBeNull();
  });

  it('vacío', () => {
    const { fixture, host, el } = setup();
    host.empty.set(true);
    fixture.detectChanges();
    expect(el.textContent).toContain('No rows');
    expect(el.textContent).toContain('Add one');
    expect(el.querySelector('#content')).toBeNull();
  });
});
