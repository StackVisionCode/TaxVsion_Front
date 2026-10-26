import { HttpClient } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { environment } from '@env/environment';
import { ApiConfigService } from '@core/config/api-config.service';
import { FIREBASE_MESSAGING_ADAPTER } from './firebase-messaging.adapter';

export type WebPushStatus = 'unsupported' | 'off' | 'registering' | 'enabled' | 'denied' | 'error';

interface PushRegistrationRecord {
  tokenId: string;
  userId: string;
  tenantId: string;
}

interface RegisterPushDeviceResponse {
  id: string;
  platform: 'Web';
  wasReactivated: boolean;
}

const REGISTRATION_KEY = 'taxproffice_push_registration';
const DEVICE_KEY = 'taxproffice_push_device_id';

@Injectable({ providedIn: 'root' })
export class WebPushRegistrationService {
  private readonly http = inject(HttpClient);
  private readonly api = inject(ApiConfigService);
  private readonly firebase = inject(FIREBASE_MESSAGING_ADAPTER);

  readonly status = signal<WebPushStatus>(this.initialStatus());
  /** Firebase entregó un token en esta página (por si el registro local no se pudo escribir). */
  private tokenIssued = false;
  /** Sube en cada logout: un alta que termina después ya no pertenece a la sesión vigente. */
  private generation = 0;

  /** Solo esta accion explicita puede abrir el prompt del navegador. */
  async enable(userId: string, tenantId: string): Promise<boolean> {
    if (!this.canUseWebPush()) {
      this.status.set('unsupported');
      return false;
    }
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      this.status.set(permission === 'denied' ? 'denied' : 'off');
      return false;
    }
    return this.register(userId, tenantId);
  }

  /** Revalida el token al entrar, sin mostrar el prompt. */
  async syncForSession(userId: string, tenantId: string): Promise<void> {
    const permission = this.notificationPermission();
    if (!this.canUseWebPush() || permission !== 'granted') {
      this.status.set(permission === 'denied' ? 'denied' : this.initialStatus());
      return;
    }
    await this.register(userId, tenantId);
  }

  /** Revoca en backend antes de que Auth borre la sesion. */
  async revokeCurrent(): Promise<void> {
    this.generation++;
    const stored = this.readRegistration();
    try {
      if (stored) {
        await firstValueFrom(
          this.http.delete<void>(
            this.api.tenantUrl(`/notifications/push/devices/${encodeURIComponent(stored.tokenId)}`),
          ),
        );
      }
    } catch {
      // La sesion pudo vencer; la limpieza local no debe bloquear el logout.
    } finally {
      try {
        // Sin registro ni token no se carga el SDK ni su worker solo para cerrar sesión.
        if ((stored || this.tokenIssued) && this.hasFirebaseConfig())
          await this.firebase.deleteToken(environment.firebase.config);
        this.tokenIssued = false;
      } catch {
        // Firebase puede estar desconectado o haber rotado el token.
      }
      this.removeRegistration();
      this.status.set(this.initialStatus());
    }
  }

  private async register(userId: string, tenantId: string): Promise<boolean> {
    const generation = this.generation;
    this.status.set('registering');
    try {
      if (!(await this.firebase.isSupported()) || !('serviceWorker' in navigator)) {
        this.status.set('unsupported');
        return false;
      }
      const worker = await navigator.serviceWorker.register(this.workerUrl(), { scope: '/' });
      const token = await this.firebase.getToken(
        environment.firebase.config,
        environment.firebase.vapidKey,
        worker,
      );
      if (!token) throw new Error('Firebase did not return a device token.');
      this.tokenIssued = true;
      if (generation !== this.generation) {
        this.status.set(this.initialStatus());
        return false;
      }

      const response = await firstValueFrom(
        this.http.post<RegisterPushDeviceResponse>(this.api.tenantUrl('/notifications/push/devices'), {
          platform: 'Web',
          token,
          deviceId: this.deviceId(),
        }),
      );
      if (generation !== this.generation) {
        // El logout llegó mientras se registraba: se deshace el alta en vez de dejarla huérfana.
        await this.discardLateRegistration(response.id);
        return false;
      }
      this.writeRegistration({ tokenId: response.id, userId, tenantId });
      this.status.set('enabled');
      return true;
    } catch {
      this.status.set('error');
      return false;
    }
  }

  private async discardLateRegistration(tokenId: string): Promise<void> {
    try {
      await firstValueFrom(
        this.http.delete<void>(
          this.api.tenantUrl(`/notifications/push/devices/${encodeURIComponent(tokenId)}`),
        ),
      );
    } catch {
      // Sin sesión el DELETE puede fallar; queda el residuo aceptado por la spec (B-3).
    }
    try {
      if (this.hasFirebaseConfig()) await this.firebase.deleteToken(environment.firebase.config);
      this.tokenIssued = false;
    } catch {
      // Firebase puede estar desconectado.
    }
    this.status.set(this.initialStatus());
  }

  private workerUrl(): string {
    const config = encodeURIComponent(JSON.stringify(environment.firebase.config));
    return `/firebase-messaging-sw.js?config=${config}`;
  }

  private deviceId(): string {
    try {
      const current = localStorage.getItem(DEVICE_KEY);
      if (current) return current;
      const created = crypto.randomUUID();
      localStorage.setItem(DEVICE_KEY, created);
      return created;
    } catch {
      return crypto.randomUUID();
    }
  }

  private initialStatus(): WebPushStatus {
    if (!this.canUseWebPush()) return 'unsupported';
    const permission = this.notificationPermission();
    if (permission === 'denied') return 'denied';
    return permission === 'granted' && this.readRegistration() ? 'enabled' : 'off';
  }

  private notificationPermission(): NotificationPermission | null {
    return typeof window !== 'undefined' && 'Notification' in window ? Notification.permission : null;
  }

  private canUseWebPush(): boolean {
    return typeof window !== 'undefined' && 'Notification' in window && this.hasFirebaseConfig();
  }

  private hasFirebaseConfig(): boolean {
    const { config, vapidKey } = environment.firebase;
    return Boolean(
      vapidKey && config.apiKey && config.authDomain && config.projectId && config.messagingSenderId && config.appId,
    );
  }

  private readRegistration(): PushRegistrationRecord | null {
    try {
      const raw = localStorage.getItem(REGISTRATION_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as Partial<PushRegistrationRecord>;
      return parsed.tokenId && parsed.userId && parsed.tenantId ? (parsed as PushRegistrationRecord) : null;
    } catch {
      return null;
    }
  }

  private writeRegistration(value: PushRegistrationRecord): void {
    try {
      localStorage.setItem(REGISTRATION_KEY, JSON.stringify(value));
    } catch {
      // El alta del servidor sigue siendo valida sin persistencia local.
    }
  }

  private removeRegistration(): void {
    try {
      localStorage.removeItem(REGISTRATION_KEY);
    } catch {
      // noop
    }
  }
}
