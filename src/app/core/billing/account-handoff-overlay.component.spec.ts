import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { AccountHandoffOverlayComponent } from './account-handoff-overlay.component';
import { AccountHandoffStore } from './account-handoff.store';

describe('AccountHandoffOverlayComponent', () => {
  function render(opening: boolean) {
    const state = signal(opening);
    TestBed.configureTestingModule({
      imports: [AccountHandoffOverlayComponent],
      providers: [{ provide: AccountHandoffStore, useValue: { opening: state } }],
    });
    const fixture = TestBed.createComponent(AccountHandoffOverlayComponent);
    fixture.detectChanges();
    return { fixture, state, page: fixture.nativeElement as HTMLElement };
  }

  afterEach(() => TestBed.resetTestingModule());

  it('cubre la pantalla y avisa a lectores de pantalla mientras abre el Account', () => {
    const { page } = render(true);

    const overlay = page.querySelector('[role="status"]');
    expect(overlay).not.toBeNull();
    expect(overlay?.getAttribute('aria-busy')).toBe('true');
    expect(page.textContent).toContain('Opening your account...');
  });

  it('no se ve cuando no hay salida en curso, y se apaga si la salida falla', () => {
    const { fixture, state, page } = render(true);

    state.set(false);
    fixture.detectChanges();

    expect(page.querySelector('[role="status"]')).toBeNull();
  });
});
