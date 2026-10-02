import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { DrawerComponent } from './drawer.component';

@Component({
  imports: [DrawerComponent],
  template: `
    <app-drawer [isOpen]="open()" heading="Task detail" subheading="Sub" width="lg" (closed)="closes = closes + 1">
      <button id="first" type="button">first</button>
      <button id="last" type="button">last</button>
      @if (withFooter()) {
        <div drawerFooter id="footer">footer</div>
      }
    </app-drawer>
  `,
})
class HostComponent {
  readonly open = signal(false);
  readonly withFooter = signal(true);
  closes = 0;
}

describe('DrawerComponent', () => {
  function setup() {
    TestBed.configureTestingModule({ imports: [HostComponent] });
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    document.body.appendChild(el);
    return { fixture, host: fixture.componentInstance, el };
  }

  afterEach(() => {
    document.body.style.overflow = '';
  });

  it('abre con cabecera, ancho y bloqueo de scroll; cierra con backdrop y Escape', () => {
    const { fixture, host, el } = setup();
    expect(el.querySelector('aside')).toBeNull();

    host.open.set(true);
    fixture.detectChanges();
    const aside = el.querySelector('aside') as HTMLElement;
    expect(aside).toBeTruthy();
    expect(aside.classList.contains('max-w-[560px]')).toBe(true);
    expect(aside.classList.contains('right-0')).toBe(true);
    expect(el.querySelector('h2')?.textContent).toContain('Task detail');
    expect(el.querySelector('#footer')).toBeTruthy();
    expect(document.body.style.overflow).toBe('hidden');

    (el.querySelector('.drawer-backdrop') as HTMLElement).click();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(host.closes).toBe(2);
    el.remove();
  });

  it('al cerrar libera el scroll tras la salida', async () => {
    const { fixture, host, el } = setup();
    host.open.set(true);
    fixture.detectChanges();
    host.open.set(false);
    fixture.detectChanges();
    await new Promise(r => setTimeout(r, 250));
    fixture.detectChanges();
    expect(el.querySelector('aside')).toBeNull();
    expect(document.body.style.overflow).toBe('');
    el.remove();
  });
});
