import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CommunicationSettingsStore } from '../../data-access/communication-settings.store';
import { ChatSettingsPageComponent } from './chat-settings-page.component';

/** Lo mínimo que lee la página: el borrador de la oficina y la configuración efectiva. */
function fakeStore(options: { managedByTenant: boolean; officeMessageDays?: number | null }) {
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
      purgeEnabled: null,
      messageRetentionDays: options.officeMessageDays ?? null,
      recordingRetentionDays: null,
    }),
    effective: signal({
      ceilings,
      chat: { edit: { windowMinutes: { Direct: 15, Group: 15, Support: 5, Meeting: 15 }, maxEdits: 5 } },
      retention: {
        messageDays: 730,
        recordingDays: 90,
        purgeEnabled: true,
        managedByTenant: options.managedByTenant,
        platformDefault: { messageDays: 730, recordingDays: 90, purgeEnabled: false },
      },
    }),
    range: vi.fn((key: string) => (key === 'messageRetentionDays' ? { min: 1, max: 3650 } : { min: 0, max: 15 })),
    set: vi.fn(),
  };
}

function render(store: ReturnType<typeof fakeStore>) {
  TestBed.configureTestingModule({
    imports: [ChatSettingsPageComponent],
    providers: [{ provide: CommunicationSettingsStore, useValue: store }],
  });
  const fixture = TestBed.createComponent(ChatSettingsPageComponent);
  fixture.detectChanges();
  return fixture.nativeElement as HTMLElement;
}

describe('ChatSettingsPageComponent — retención (D-72)', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('sin la capacidad: muestra la retención de la plataforma y no se puede editar', () => {
    const el = render(fakeStore({ managedByTenant: false }));

    expect(el.querySelector('[data-role="retention-messages"]')?.textContent?.trim()).toBe('730 days');
    expect(el.querySelector('[data-role="retention-cleanup"]')?.textContent?.trim()).toBe(
      'On — managed by your platform administrator',
    );
    expect(el.querySelector('[aria-label="Automatic cleanup"]')).toBeNull();
    expect(el.querySelector('[aria-label="Messages are kept for"]')).toBeNull();
  });

  it('con la capacidad: interruptor de limpieza y días editables dentro del rango técnico', () => {
    const store = fakeStore({ managedByTenant: true, officeMessageDays: 30 });
    const el = render(store);

    expect(el.querySelector('[data-role="retention-cleanup"]')).toBeNull();
    expect(el.querySelector('[aria-label="Automatic cleanup"]')).not.toBeNull();
    const days = el.querySelector<HTMLInputElement>('input[aria-label="Messages are kept for"]');
    expect(days?.value).toBe('30');
    expect(days?.max).toBe('3650');
    expect(store.range).toHaveBeenCalledWith('messageRetentionDays');

    days!.value = '90';
    days!.dispatchEvent(new Event('change'));
    expect(store.set).toHaveBeenCalledWith('messageRetentionDays', 90);
  });

  it('con la capacidad y sin valor propio: ofrece el default de la plataforma', () => {
    const el = render(fakeStore({ managedByTenant: true }));
    expect(el.textContent).toContain('Use default (730 days)');
    expect(el.querySelector('[data-role="inherit-default"]')?.textContent?.trim()).toBe('Platform default');
  });
});
