import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { provideRouter } from '@angular/router';
import { Subject, of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { MediaPolicyService } from '@core/communication/media/media-policy.service';
import { MediaDevicesService } from '@core/communication/media/media-devices.service';
import { ToastService } from '@shared/ui/toast/toast.service';
import { CommunicationRealtimeService } from '@core/realtime/communication-realtime.service';
import { CommunicationPreferencesService, CommunicationPreferencesView } from '../../data-access/communication-preferences.service';
import { CommunicationPreferencesPageComponent } from './communication-preferences-page.component';

function view(over: Partial<CommunicationPreferencesView> = {}): CommunicationPreferencesView {
  return {
    preferences: {
      meetingSoundsMuted: false,
      transcriptLanguage: null,
      preferAudioOnly: false,
      echoCancellation: null,
      noiseSuppression: null,
      autoGainControl: null,
      joinMuted: false,
      joinCameraOff: false,
      autoPictureInPicture: false,
    },
    effective: { transcriptLanguage: 'en' },
    soundsPolicy: 'all',
    ...over,
  };
}

function setup(prefs = view(), update = vi.fn(() => Promise.resolve({}))) {
  const toast = { error: vi.fn(), success: vi.fn() };
  const events = new Subject<{ scope: string; version: number }>();
  const get = vi.fn(() => of(prefs));
  TestBed.configureTestingModule({
    imports: [CommunicationPreferencesPageComponent],
    providers: [
      provideRouter([]),
      { provide: CommunicationPreferencesService, useValue: { get } },
      { provide: CommunicationRealtimeService, useValue: { on: () => events.asObservable() } },
      { provide: MediaPolicyService, useValue: { policy: signal(null), ensureLoaded: () => Promise.resolve({}), updatePreferences: update } },
      {
        provide: MediaDevicesService,
        useValue: {
          microphones: signal([]),
          cameras: signal([]),
          speakers: signal([]),
          preferred: signal({ audioInputId: null, videoInputId: null, audioOutputId: null }),
          supportsSinkId: false,
          refreshInventory: () => Promise.resolve(),
          setPreferred: vi.fn(),
        },
      },
      { provide: ToastService, useValue: toast },
    ],
  });
  const fixture = TestBed.createComponent(CommunicationPreferencesPageComponent);
  fixture.detectChanges();
  return { fixture, cmp: fixture.componentInstance, update, toast, events, get };
}

/** F9 — preferencias personales de Communication (autoservicio, guardado al momento). */
describe('CommunicationPreferencesPageComponent', () => {
  it('cada cambio se guarda al momento con solo ese campo', async () => {
    const { cmp, update } = setup();
    await cmp.set('joinMuted', true);
    expect(update).toHaveBeenCalledWith({ joinMuted: true });
    expect(cmp.view()?.preferences.joinMuted).toBe(true);
  });

  it('si el servidor lo rechaza vuelve al valor anterior y avisa', async () => {
    const { cmp, toast } = setup(view(), vi.fn(() => Promise.reject(new Error('400'))));
    await cmp.set('preferAudioOnly', true);
    expect(cmp.view()?.preferences.preferAudioOnly).toBe(false);
    expect(toast.error).toHaveBeenCalled();
  });

  it('con los sonidos apagados por la oficina, el interruptor personal no se puede usar', () => {
    const { fixture } = setup(view({ soundsPolicy: 'off' }));
    expect((fixture.nativeElement as HTMLElement).querySelector('[data-role="setting-locked"]')?.textContent).toContain(
      'Your office has turned these sounds off.',
    );
  });

  it('si la oficina apaga los sonidos, el bloqueo aparece sin recargar', () => {
    const { fixture, events, get } = setup();
    get.mockReturnValue(of(view({ soundsPolicy: 'off' })));
    events.next({ scope: 'tenant', version: 2 });
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).querySelector('[data-role="setting-locked"]')).not.toBeNull();
  });

  it('"Office default" en el idioma guarda null', async () => {
    const { cmp, update } = setup(view({ preferences: { ...view().preferences, transcriptLanguage: 'es' } }));
    cmp.setLanguage('');
    await Promise.resolve();
    expect(update).toHaveBeenCalledWith({ transcriptLanguage: null });
  });
});
