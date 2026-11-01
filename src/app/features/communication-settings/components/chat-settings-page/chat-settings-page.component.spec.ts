import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CommunicationSettingsStore } from '../../data-access/communication-settings.store';
import { ChatSettingsPageComponent } from './chat-settings-page.component';

/** Lo mínimo que lee la página: el borrador de la oficina y la configuración efectiva. */
function fakeStore() {
  const ceilings = new Proxy({}, { get: () => 15 });
  return {
    draft: signal({
      chatEnabled: true,
      screenshotsEnabled: true,
      employeeToEmployeeChatEnabled: false,
      restrictCustomerChatToAssignedPreparer: false,
      groupsAllowMultipleClients: false,
      chatEditWindowMinutesDirect: null,
      chatEditWindowMinutesGroup: null,
      chatEditWindowMinutesSupport: null,
      chatEditWindowMinutesMeeting: null,
      chatMaxEditsPerMessage: null,
    }),
    effective: signal({
      ceilings,
      chat: { edit: { windowMinutes: { Direct: 15, Group: 15, Support: 5, Meeting: 15 }, maxEdits: 5 } },
      retention: { messageDays: 730, recordingDays: 90, purgeEnabled: true },
    }),
    range: () => ({ min: 0, max: 15 }),
    set: vi.fn(),
  };
}

describe('ChatSettingsPageComponent — retención', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('muestra la retención que fijó la plataforma y la oficina no la puede editar', () => {
    const store = fakeStore();
    TestBed.configureTestingModule({
      imports: [ChatSettingsPageComponent],
      providers: [{ provide: CommunicationSettingsStore, useValue: store }],
    });
    const fixture = TestBed.createComponent(ChatSettingsPageComponent);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;

    expect(el.querySelector('[data-role="retention-messages"]')?.textContent?.trim()).toBe('730 days');
    expect(el.querySelector('[data-role="retention-cleanup"]')?.textContent?.trim()).toBe('On');
    expect(el.querySelector('[aria-label="Automatic cleanup"]')).toBeNull();
    expect(el.textContent).not.toContain('Message retention');
  });
});
