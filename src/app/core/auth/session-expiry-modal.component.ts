import { Component, CUSTOM_ELEMENTS_SCHEMA, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { SessionExpiryService } from '../services/session-expiry.service';

/**
 * Aviso de sesión por expirar (access token 15 min): da al usuario la opción de mantenerla (refresh) o
 * cerrarla, en vez de sacarlo en seco. Se renderiza en el root (app-root) para estar disponible en toda
 * la app autenticada. La lógica de tiempos vive en SessionExpiryService; esto solo pinta el estado.
 */
@Component({
  selector: 'app-session-expiry-modal',
  standalone: true,
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: `
    @if (show()) {
      <div
        class="fixed inset-0 z-[100] flex items-center justify-center bg-brand-ink/40 backdrop-blur-sm p-4"
      >
        <div class="w-full max-w-sm bg-white rounded-[1.75rem] shadow-2xl shadow-brand-ink/20 p-8 text-center">
          <span
            class="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-amber-100 text-amber-500"
          >
            <ion-icon name="timer-outline" class="text-3xl"></ion-icon>
          </span>
          <h2 class="mt-4 text-xl font-bold text-gray-900">Session expiring soon</h2>
          <p class="mt-1 text-sm text-gray-500">
            You'll be signed out due to inactivity in
            <span class="font-semibold text-gray-800">{{ formatTime(remainingSeconds()) }}</span
            >.
          </p>

          <div class="mt-5 h-2 w-full overflow-hidden rounded-full bg-gray-100">
            <div
              class="h-full rounded-full transition-[width] duration-1000 ease-linear"
              [class.bg-red-500]="remainingSeconds() <= 15"
              [class.bg-amber-400]="remainingSeconds() > 15"
              [style.width.%]="progress()"
            ></div>
          </div>

          <div class="mt-6 flex items-center gap-3">
            <button
              type="button"
              (click)="onLogout()"
              class="flex-1 rounded-xl border border-gray-200 px-4 py-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-50 transition-colors"
            >
              Log out
            </button>
            <button
              type="button"
              (click)="onKeepSession()"
              class="flex-1 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 transition-colors"
            >
              Keep me signed in
            </button>
          </div>
        </div>
      </div>
    }
  `,
})
export class SessionExpiryModalComponent {
  private readonly service = inject(SessionExpiryService);
  private readonly destroyRef = inject(DestroyRef);

  readonly show = signal(false);
  readonly remainingSeconds = signal(0);

  constructor() {
    this.service.expiryState$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((state) => {
      this.show.set(state.show);
      this.remainingSeconds.set(state.remainingSeconds);
    });
  }

  /** Barra de progreso sobre la ventana de aviso de 60s. */
  progress(): number {
    return Math.min(100, (this.remainingSeconds() / 60) * 100);
  }

  formatTime(seconds: number): string {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return mins > 0 ? `${mins}:${secs.toString().padStart(2, '0')}` : `${secs}s`;
  }

  onKeepSession(): void {
    this.service.extendSession();
  }

  onLogout(): void {
    this.service.endSession();
  }
}
