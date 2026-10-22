import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { AccountHandoffStore } from './account-handoff.store';

/**
 * Capa de "Opening your account" mientras se pide el vale y el navegador carga el Landing. Mismo diseño
 * que la pantalla de carga del Landing (index.html y /account/continue): el paso entre sitios se ve como
 * una sola carga continua, sin el CRM a medio irse ni la página en blanco del medio.
 *
 * Montada una vez en `app.html` (como la transición de login) para cubrir cualquier pantalla que abra el
 * Account: el menú de usuario, el banner y la pantalla de cuenta suspendida.
 */
@Component({
  selector: 'app-account-handoff-overlay',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (handoff.opening()) {
      <!-- z-[90]: sobre los toasts (80) y debajo de los modales de sesión (100), igual que la transición de login. -->
      <div
        class="handoff-overlay fixed inset-0 z-[90] flex flex-col items-center justify-center bg-[#FAFAFA] px-6 text-center"
        role="status"
        aria-live="polite"
        aria-busy="true"
      >
        <svg class="flow" viewBox="0 0 64 32" fill="none" aria-hidden="true">
          <path class="flow-base" pathLength="100" [attr.d]="path" />
          <path class="flow-trail" pathLength="100" [attr.d]="path" />
          <path class="flow-head" pathLength="100" [attr.d]="path" />
        </svg>
        <p class="caption mt-7 text-base font-semibold text-[#083645]">Opening your account...</p>
        <p class="sub mt-1.5 max-w-sm text-sm text-[#3E5F6B]">One moment while we connect you to your subscription.</p>
        <div class="bar mt-5" aria-hidden="true"><span></span></div>
      </div>
    }
  `,
  styles: `
    .handoff-overlay {
      animation: ho-in 220ms ease-out both;
    }
    @keyframes ho-in {
      from { opacity: 0; }
      to { opacity: 1; }
    }
    .flow {
      width: 7.5rem;
      height: 3.75rem;
      overflow: visible;
      stroke-linecap: round;
      stroke-linejoin: round;
      stroke-width: 3;
    }
    .flow-base { stroke: #057bc1; opacity: 0.16; }
    .flow-trail {
      stroke: #057bc1;
      stroke-dasharray: 30 70;
      opacity: 0.6;
      animation: ho-run 2.2s cubic-bezier(0.45, 0, 0.35, 1) infinite;
    }
    .flow-head {
      stroke: #4dd8ff;
      stroke-dasharray: 9 91;
      filter: drop-shadow(0 0 4px rgba(77, 216, 255, 0.95));
      animation: ho-run 2.2s cubic-bezier(0.45, 0, 0.35, 1) infinite;
    }
    @keyframes ho-run {
      from { stroke-dashoffset: 0; }
      to { stroke-dashoffset: -100; }
    }
    .caption,
    .sub {
      animation: ho-caption 360ms ease 120ms both;
    }
    @keyframes ho-caption {
      from { opacity: 0; transform: translateY(6px); }
      to { opacity: 1; transform: none; }
    }
    .bar {
      height: 0.1875rem;
      width: 10rem;
      overflow: hidden;
      border-radius: 999px;
      background: #e4dccf;
    }
    .bar span {
      display: block;
      height: 100%;
      width: 40%;
      border-radius: inherit;
      background: #057bc1;
      animation: ho-bar 1.4s ease-in-out infinite;
    }
    @keyframes ho-bar {
      from { transform: translateX(-100%); }
      to { transform: translateX(250%); }
    }
    @media (prefers-reduced-motion: reduce) {
      .handoff-overlay,
      .caption,
      .sub,
      .flow-trail,
      .flow-head,
      .bar span {
        animation: none;
      }
      .flow-head { stroke-dasharray: 100 0; opacity: 0.6; }
      .bar span { width: 100%; }
    }
  `,
})
export class AccountHandoffOverlayComponent {
  protected readonly handoff = inject(AccountHandoffStore);

  /** Lemniscata de `InfinityLoaderComponent`: dos lazos unidos en el centro (32,16). */
  protected readonly path =
    'M32 16 C24 4 14 4 10 4 C5 4 2 9 2 16 C2 23 5 28 10 28 C14 28 24 28 32 16 C40 4 50 4 54 4 C59 4 62 9 62 16 C62 23 59 28 54 28 C50 28 40 28 32 16 Z';
}
