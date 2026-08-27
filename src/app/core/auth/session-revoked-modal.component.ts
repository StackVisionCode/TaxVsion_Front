import { Component, inject } from '@angular/core';
import { SessionRevocationService } from './session-revocation.service';

/**
 * Sesión única — aviso en el dispositivo VIEJO. Overlay full-screen que aparece cuando el usuario
 * abre una sesión nueva en otro dispositivo (`session.revoked` por el socket). Se monta en la raíz
 * de la app para poder cubrir cualquier ruta. Su botón vuelve al login.
 */
@Component({
  selector: 'app-session-revoked-modal',
  standalone: true,
  template: `
    @if (revocation.revoked()) {
      <div
        class="fixed inset-0 z-[100] flex items-center justify-center bg-indigo-50/95 backdrop-blur-sm p-4 sm:p-8 overflow-hidden"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="session-revoked-title"
      >
        <div class="pointer-events-none absolute -top-32 -left-32 h-96 w-96 rounded-full bg-indigo-300/40 blur-3xl"></div>
        <div class="pointer-events-none absolute -bottom-32 -right-24 h-96 w-96 rounded-full bg-brand-light/30 blur-3xl"></div>

        <div class="session-revoked-card relative w-full max-w-md rounded-[2rem] bg-white px-8 py-10 text-center shadow-2xl shadow-brand-light/40 sm:px-10">
          <div class="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-indigo-50">
            <svg class="h-8 w-8 text-indigo-600" fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15m3 0l3-3m0 0l-3-3m3 3H9" />
            </svg>
          </div>

          <h1 id="session-revoked-title" class="text-2xl font-bold text-gray-900">You've been signed out</h1>
          <p class="mt-3 text-sm leading-relaxed text-gray-500">
            Your account was signed in on another device. For your security, only one session can be
            active at a time.
          </p>

          <button
            type="button"
            (click)="dismiss()"
            class="mt-8 w-full rounded-xl bg-indigo-600 py-3 text-sm font-semibold text-white transition-colors hover:bg-indigo-700"
          >
            Sign back in
          </button>
        </div>
      </div>
    }
  `,
  styles: [
    `
      @keyframes session-revoked-in {
        from {
          opacity: 0;
          transform: translateY(12px) scale(0.98);
        }
        to {
          opacity: 1;
          transform: translateY(0) scale(1);
        }
      }
      .session-revoked-card {
        animation: session-revoked-in 320ms cubic-bezier(0.16, 1, 0.3, 1) both;
      }
    `,
  ],
})
export class SessionRevokedModalComponent {
  protected readonly revocation = inject(SessionRevocationService);

  dismiss(): void {
    this.revocation.dismiss();
  }
}
