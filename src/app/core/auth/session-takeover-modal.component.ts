import { Component, inject } from '@angular/core';
import { SessionTakeoverService } from './session-takeover.service';

/**
 * Sesión única — interstitial en el dispositivo NUEVO. Aparece cuando el login detecta una sesión
 * previa activa: el usuario decide continuar (cierra la otra) o cancelar. Montado en la raíz para
 * poder mostrarse sobre cualquier pantalla de login.
 */
@Component({
  selector: 'app-session-takeover-modal',
  standalone: true,
  template: `
    @if (takeover.ticket()) {
      <div
        class="fixed inset-0 z-[100] flex items-center justify-center bg-gray-900/30 p-4 backdrop-blur-sm"
        role="dialog"
        aria-modal="true"
        aria-labelledby="session-takeover-title"
      >
        <div class="session-takeover-card w-full max-w-md rounded-[2rem] bg-white px-8 py-9 text-center shadow-2xl sm:px-10">
          <div class="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-indigo-50">
            <svg class="h-8 w-8 text-indigo-600" fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>

          <h1 id="session-takeover-title" class="text-2xl font-bold text-gray-900">You're already signed in</h1>
          <p class="mt-3 text-sm leading-relaxed text-gray-500">
            Your account is active on another device. Only one session can be open at a time. Continue
            here to sign out the other device.
          </p>

          @if (takeover.error(); as err) {
            <p class="mt-4 text-sm font-medium text-red-600">{{ err }}</p>
          }

          <div class="mt-8 flex flex-col gap-3">
            <button
              type="button"
              (click)="takeover.confirm()"
              [disabled]="takeover.busy()"
              class="flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 py-3 text-sm font-semibold text-white transition-colors hover:bg-indigo-700 disabled:opacity-60"
            >
              @if (takeover.busy()) {
                <span class="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white"></span>
                <span>Signing you in...</span>
              } @else {
                <span>Continue here</span>
              }
            </button>
            <button
              type="button"
              (click)="takeover.cancel()"
              [disabled]="takeover.busy()"
              class="w-full rounded-xl py-3 text-sm font-semibold text-gray-500 transition-colors hover:text-gray-700 disabled:opacity-60"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    }
  `,
  styles: [
    `
      @keyframes session-takeover-in {
        from {
          opacity: 0;
          transform: translateY(12px) scale(0.98);
        }
        to {
          opacity: 1;
          transform: translateY(0) scale(1);
        }
      }
      .session-takeover-card {
        animation: session-takeover-in 280ms cubic-bezier(0.16, 1, 0.3, 1) both;
      }
    `,
  ],
})
export class SessionTakeoverModalComponent {
  protected readonly takeover = inject(SessionTakeoverService);
}
