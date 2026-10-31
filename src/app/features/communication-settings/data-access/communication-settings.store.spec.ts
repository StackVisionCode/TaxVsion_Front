import { TestBed } from '@angular/core/testing';
import { Subject, of, throwError } from 'rxjs';
import { HttpErrorResponse } from '@angular/common/http';
import { describe, expect, it, vi } from 'vitest';
import { CommunicationRealtimeService } from '@core/realtime/communication-realtime.service';
import { CommunicationSettingsService } from './communication-settings.service';
import { CommunicationSettingsStore } from './communication-settings.store';
import type { CommunicationSettingsOverview } from './communication-settings.model';

function overview(over: Partial<CommunicationSettingsOverview['settings']> = {}): CommunicationSettingsOverview {
  return {
    settings: { chatEnabled: true, employeeToEmployeeChatEnabled: false, defaultMeetingDurationMinutes: null, ...over } as CommunicationSettingsOverview['settings'],
    effective: { ceilings: { maxMeetingDurationMinutes: 60 } } as CommunicationSettingsOverview['effective'],
    ranges: { defaultMeetingDurationMinutes: { min: 5, max: 480 } } as CommunicationSettingsOverview['ranges'],
    transcriptPromptMaxLength: 500,
  };
}

function setup(update: CommunicationSettingsService['update'] = vi.fn(() => of(overview({ employeeToEmployeeChatEnabled: true })))) {
  const events = new Subject<{ scope: string; version: number }>();
  const service = { get: vi.fn(() => of(overview())), update };
  TestBed.configureTestingModule({
    providers: [
      CommunicationSettingsStore,
      { provide: CommunicationSettingsService, useValue: service },
      { provide: CommunicationRealtimeService, useValue: { on: () => events.asObservable() } },
    ],
  });
  const store = TestBed.inject(CommunicationSettingsStore);
  store.ensureLoaded();
  return { store, service, events };
}

/** F9 — borrador compartido de Settings → Communication. */
describe('CommunicationSettingsStore', () => {
  it('solo manda lo cambiado y el borrador se rehace con la vista que devuelve el servidor', async () => {
    const { store, service } = setup();
    expect(store.dirty()).toBe(false);

    store.set('employeeToEmployeeChatEnabled', true);
    expect(store.dirty()).toBe(true);
    expect(await store.save()).toBe(true);

    expect(service.update).toHaveBeenCalledWith({ employeeToEmployeeChatEnabled: true });
    expect(store.dirty()).toBe(false);
    expect(store.draft()?.employeeToEmployeeChatEnabled).toBe(true);
  });

  it('un rechazo por techo se explica en palabras de la oficina y conserva el borrador', async () => {
    const error = new HttpErrorResponse({ status: 400, error: { code: 'Settings.AboveCeiling', message: 'defaultMeetingDurationMinutes cannot exceed 60.' } });
    const { store } = setup(vi.fn(() => throwError(() => error)));
    store.set('defaultMeetingDurationMinutes', 90);

    expect(await store.save()).toBe(false);
    expect(store.saveError()).toBe("One of the values is above your office's limit. Lower it and try again.");
    expect(store.draft()?.defaultMeetingDurationMinutes).toBe(90);
  });

  it('el máximo de un número es el menor entre el rango técnico y el techo', () => {
    const { store } = setup();
    expect(store.range('defaultMeetingDurationMinutes', 60)).toEqual({ min: 5, max: 60 });
    expect(store.range('defaultMeetingDurationMinutes')).toEqual({ min: 5, max: 480 });
  });

  it('si otra sesión cambia la configuración: recarga, salvo que haya cambios sin guardar', () => {
    const { store, service, events } = setup();
    events.next({ scope: 'tenant', version: 2 });
    expect(service.get).toHaveBeenCalledTimes(2);

    store.set('chatEnabled', false);
    events.next({ scope: 'tenant', version: 3 });
    expect(service.get).toHaveBeenCalledTimes(2);
    expect(store.changedElsewhere()).toBe(true);

    events.next({ scope: 'user', version: 4 });
    expect(service.get).toHaveBeenCalledTimes(2);
  });

  it('al cargar lo de otra sesión se conserva lo propio sin guardar', () => {
    const { store, service } = setup();
    store.set('chatEnabled', false);
    service.get.mockReturnValue(of(overview({ employeeToEmployeeChatEnabled: true })));
    store.reload();

    expect(store.draft()?.employeeToEmployeeChatEnabled).toBe(true);
    expect(store.pendingChanges()).toEqual({ chatEnabled: false });
  });

  it('descartar vuelve a lo guardado', () => {
    const { store } = setup();
    store.set('chatEnabled', false);
    store.discard();
    expect(store.dirty()).toBe(false);
  });
});
