import { CUSTOM_ELEMENTS_SCHEMA, Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { toApiError } from '@core/models/api-error.model';
import { MediaPolicyService } from '@core/communication/media/media-policy.service';
import { MediaDevicesService, PreferredDevices } from '@core/communication/media/media-devices.service';
import type { MediaPreferencesPatch } from '@core/communication/media/media-policy.model';
import { CommunicationRealtimeService } from '@core/realtime/communication-realtime.service';
import { SETTINGS_CHANGED_EVENT, SettingsChangedEvent } from '@core/realtime/realtime.model';
import { SwitchComponent } from '@shared/ui/switch/switch.component';
import { StateBlockComponent } from '@shared/ui/state-block/state-block.component';
import { ToastService } from '@shared/ui/toast/toast.service';
import {
  CommunicationPreferences,
  CommunicationPreferencesService,
  CommunicationPreferencesView,
} from '../../data-access/communication-preferences.service';
import { TRANSCRIPT_LANGUAGE_OPTIONS } from '../../data-access/communication-settings.model';
import { CommSettingsSectionComponent } from '../../ui/settings-section/settings-section.component';
import { CommSettingRowComponent } from '../../ui/setting-row/setting-row.component';
import { CommInheritSwitchComponent } from '../../ui/inherit-switch/inherit-switch.component';

type ProcessingKey = 'echoCancellation' | 'noiseSuppression' | 'autoGainControl';

/**
 * F9 — Settings → Communication preferences (autoservicio, cualquier usuario): sonidos, cómo entro a una reunión,
 * procesamiento de audio, ventana flotante, idioma del transcript de mis notas y dispositivos por defecto.
 * Cada cambio se guarda al momento (optimista, como Notifications). Los dispositivos son de este navegador: sus
 * ids no sirven en otro equipo, así que no van al servidor (INV-06). Si la oficina cambia algo (p. ej. apaga los
 * sonidos) la vista se refresca sola.
 */
@Component({
  selector: 'app-communication-preferences-page',
  imports: [RouterLink, SwitchComponent, StateBlockComponent, CommSettingsSectionComponent, CommSettingRowComponent, CommInheritSwitchComponent],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './communication-preferences-page.component.html',
})
export class CommunicationPreferencesPageComponent implements OnInit {
  private readonly service = inject(CommunicationPreferencesService);
  private readonly mediaPolicy = inject(MediaPolicyService);
  private readonly toast = inject(ToastService);
  protected readonly devices = inject(MediaDevicesService);

  readonly view = signal<CommunicationPreferencesView | null>(null);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly askingDevices = signal(false);
  readonly languageOptions = TRANSCRIPT_LANGUAGE_OPTIONS;

  constructor() {
    inject(CommunicationRealtimeService)
      .on<SettingsChangedEvent>(SETTINGS_CHANGED_EVENT)
      .pipe(takeUntilDestroyed(inject(DestroyRef)))
      .subscribe(event => {
        if (event.scope !== 'user' && this.view()) this.refresh();
      });
  }

  /** Procesamiento vigente para mí (oficina, o mi preferencia si la fijé). */
  readonly processing = computed(() => this.mediaPolicy.policy()?.audio.processing ?? null);
  readonly soundsOff = computed(() => this.view()?.soundsPolicy === 'off');
  /** Sin permiso del navegador los dispositivos llegan sin nombre. */
  readonly needsDeviceNames = computed(() =>
    [...this.devices.microphones(), ...this.devices.cameras()].some(device => !device.label),
  );

  ngOnInit(): void {
    this.load();
    void this.mediaPolicy.ensureLoaded().catch(() => undefined);
    void this.devices.refreshInventory();
  }

  load(): void {
    this.loading.set(true);
    this.error.set(null);
    this.service.get().subscribe({
      next: view => {
        this.view.set(view);
        this.loading.set(false);
      },
      error: err => {
        this.error.set(toApiError(err).message);
        this.loading.set(false);
      },
    });
  }

  /** Relee sin el estado de carga (la página ya está pintada). */
  private refresh(): void {
    this.service.get().subscribe({ next: view => this.view.set(view), error: () => undefined });
  }

  /** Guarda un cambio al momento; si el servidor lo rechaza vuelve al valor anterior. */
  async set<K extends keyof CommunicationPreferences & keyof MediaPreferencesPatch>(
    key: K,
    value: CommunicationPreferences[K],
  ): Promise<void> {
    const view = this.view();
    if (!view) return;
    const previous = view.preferences[key];
    this.patchLocally(key, value);
    try {
      await this.mediaPolicy.updatePreferences({ [key]: value } as MediaPreferencesPatch);
    } catch {
      this.patchLocally(key, previous);
      this.toast.error("Couldn't save your preference. Try again.");
    }
  }

  setProcessing(key: ProcessingKey, value: boolean | null): void {
    void this.set(key, value);
  }

  setLanguage(value: string): void {
    void this.set('transcriptLanguage', value === '' ? null : value);
  }

  setDevice(key: keyof PreferredDevices, deviceId: string): void {
    this.devices.setPreferred(key, deviceId === '' ? null : deviceId);
  }

  async testSpeaker(): Promise<void> {
    if (!(await this.devices.testSpeaker())) this.toast.error("Couldn't play the test sound on that speaker.");
  }

  /** Pide permiso un momento para que el navegador muestre los nombres; la captura se suelta enseguida. */
  async showDeviceNames(): Promise<void> {
    this.askingDevices.set(true);
    try {
      const stream = await this.devices.getUserMedia({ audio: true, video: true }, 'camera', { fallbackWhenUnreadable: true });
      stream.getTracks().forEach(track => track.stop());
      await this.devices.refreshInventory();
    } catch {
      this.toast.error('Your browser blocked access to the camera and microphone. Allow it in the site settings.');
    } finally {
      this.askingDevices.set(false);
    }
  }

  deviceLabel(device: MediaDeviceInfo, index: number, kind: string): string {
    return device.label || `${kind} ${index + 1}`;
  }

  private patchLocally<K extends keyof CommunicationPreferences>(key: K, value: CommunicationPreferences[K]): void {
    this.view.update(view => (view ? { ...view, preferences: { ...view.preferences, [key]: value } } : view));
  }
}
