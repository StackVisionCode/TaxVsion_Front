import { Component, inject } from '@angular/core';
import { SessionTakeoverService } from './session-takeover.service';
import { InfinityLoaderComponent } from '@shared/ui/infinity-loader/infinity-loader.component';

/**
 * Sesión única — interstitial en el dispositivo NUEVO. Aparece cuando el login detecta una sesión
 * previa activa: el usuario decide continuar (cierra la otra) o cancelar. Montado en la raíz para
 * poder mostrarse sobre cualquier pantalla de login.
 */
@Component({
  selector: 'app-session-takeover-modal',
  standalone: true,
  imports: [InfinityLoaderComponent],
  template: `
    @if (takeover.ticket()) {
      <div
        class="fixed inset-0 z-[100] flex items-center justify-center bg-[#083645]/45 p-4 backdrop-blur-sm"
        role="dialog"
        aria-modal="true"
        aria-labelledby="session-takeover-title"
      >
        <div class="session-takeover-card w-full max-w-[24rem] rounded-[1.75rem] border border-[#E4DCCF] bg-white px-7 py-8 text-center text-[#083645] shadow-[0_24px_60px_-12px_rgba(8,54,69,0.35)] sm:px-9">
          <div class="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-[#057BC1]/10">
            <svg class="h-7 w-7 text-[#057BC1]" fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>

          <h1 id="session-takeover-title" class="text-[1.625rem] font-semibold leading-tight tracking-tight text-[#083645]">You're already signed in</h1>
          <p class="mt-3 text-sm leading-relaxed text-[#3E5F6B]">
            Your account is active on another device. Only one session can be open at a time. Continue
            here to sign out the other device.
          </p>

          @if (takeover.error(); as err) {
            <p class="mt-4 rounded-xl bg-red-50 px-3 py-2 text-sm font-medium text-red-600">{{ err }}</p>
          }

          <div class="mt-7 flex flex-col gap-2">
            <button
              type="button"
              (click)="takeover.confirm()"
              [disabled]="takeover.busy()"
              class="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#083645] text-sm font-semibold text-white transition-colors hover:bg-[#057BC1] disabled:opacity-70"
            >
              @if (takeover.busy()) {
                <app-infinity-loader size="xs" tone="light" />
                <span>Signing you in...</span>
              } @else {
                <span>Continue here</span>
              }
            </button>
            <button
              type="button"
              (click)="takeover.cancel()"
              [disabled]="takeover.busy()"
              class="h-11 w-full rounded-xl text-sm font-semibold text-[#3E5F6B] transition-colors hover:bg-[#F8F4ED] hover:text-[#083645] disabled:opacity-60"
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
