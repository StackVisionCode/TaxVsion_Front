import { TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { of, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ClipboardService } from '@shared/services/clipboard.service';
import { MeetingsStore } from '../../data-access/meetings.store';
import { MeetingGuestAccess } from '../../data-access/meeting.model';
import { MeetingGuestAccessComponent } from './meeting-guest-access.component';

const LINK = 'https://office.taxoffix.test/meet/m1.abc';

function access(overrides: Partial<MeetingGuestAccess> = {}): MeetingGuestAccess {
  return { guestsAllowed: true, officeAllowsGuests: true, guestLinkUrl: null, ...overrides };
}

function render(initial: MeetingGuestAccess = access()) {
  const store = {
    getGuestAccess: vi.fn().mockReturnValue(of(initial)),
    setGuestAccess: vi.fn(),
    enableGuestLink: vi.fn(),
    disableGuestLink: vi.fn(),
  };
  const clipboard = { copy: vi.fn().mockResolvedValue(true) };
  TestBed.configureTestingModule({
    providers: [
      { provide: MeetingsStore, useValue: store },
      { provide: ClipboardService, useValue: clipboard },
    ],
  });
  const fixture = TestBed.createComponent(MeetingGuestAccessComponent);
  const emitted: MeetingGuestAccess[] = [];
  fixture.componentInstance.accessChange.subscribe(value => emitted.push(value));
  fixture.componentRef.setInput('meetingId', 'm1');
  fixture.detectChanges();
  const el = fixture.nativeElement as HTMLElement;
  return { fixture, store, clipboard, el, emitted, component: fixture.componentInstance };
}

describe('MeetingGuestAccessComponent (D-68/D-69)', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('carga el acceso, lo avisa al padre y ofrece crear el enlace', () => {
    const { el, store, emitted } = render();
    expect(store.getGuestAccess).toHaveBeenCalledWith('m1');
    expect(emitted).toEqual([access()]);
    expect(el.querySelector('[data-role="create-guest-link"]')).not.toBeNull();
  });

  it('crea, copia, rota y apaga el enlace', async () => {
    const { fixture, el, store, clipboard } = render();
    store.enableGuestLink.mockReturnValue(of(access({ guestLinkUrl: LINK })));
    fixture.componentInstance.createLink();
    fixture.detectChanges();
    expect(store.enableGuestLink).toHaveBeenCalledWith('m1', false);
    expect(el.querySelector('[data-role="guest-link-url"]')?.textContent).toContain(LINK);

    (el.querySelector('[data-role="copy-guest-link"]') as HTMLButtonElement).click();
    await fixture.whenStable();
    expect(clipboard.copy).toHaveBeenCalledWith(LINK);

    store.enableGuestLink.mockReturnValue(of(access({ guestLinkUrl: `${LINK}2` })));
    fixture.componentInstance.rotateLink();
    expect(store.enableGuestLink).toHaveBeenLastCalledWith('m1', true);

    store.disableGuestLink.mockReturnValue(of(access()));
    fixture.componentInstance.turnOffLink();
    fixture.detectChanges();
    expect(el.querySelector('[data-role="guest-link-url"]')).toBeNull();
  });

  it('apagar los externos esconde el enlace; sin permiso de la oficina el switch queda bloqueado', () => {
    const { fixture, el, store } = render(access({ guestLinkUrl: LINK }));
    store.setGuestAccess.mockReturnValue(of(access({ guestsAllowed: false })));
    fixture.componentInstance.setAllowed(false);
    fixture.detectChanges();
    expect(store.setGuestAccess).toHaveBeenCalledWith('m1', false);
    expect(el.querySelector('[data-role="guest-link"]')).toBeNull();
    TestBed.resetTestingModule();

    const office = render(access({ guestsAllowed: false, officeAllowsGuests: false }));
    expect(office.el.textContent).toContain("Your office doesn't allow external guests.");
    expect(office.el.querySelector('app-switch button')?.hasAttribute('disabled')).toBe(true);
  });

  it('traduce el rechazo de la oficina a copy propia', () => {
    const { fixture, el, store } = render(access({ guestsAllowed: false }));
    store.setGuestAccess.mockReturnValue(
      throwError(() => new HttpErrorResponse({ status: 400, error: { code: 'Meeting.GuestsNotAllowed', message: 'x' } })),
    );
    fixture.componentInstance.setAllowed(true);
    fixture.detectChanges();
    expect(el.querySelector('[data-role="guest-access-error"]')?.textContent).toContain("Your office doesn't allow external guests.");
  });
});
