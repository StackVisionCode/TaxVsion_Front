import { Component, CUSTOM_ELEMENTS_SCHEMA, EventEmitter, Input, Output } from '@angular/core';

export interface CheckRingItem {
  id: string;
  label: string;
  done: boolean;
  /** Ancla a la que lleva el chip cuando falta (se emite en `fix`). */
  target: string;
}

export type CheckRingTone = 'strong' | 'good' | 'weak';

/**
 * Anillo de avance + chips de lo que falta (cabecera de Profile: seguridad; de Office Settings: datos
 * de factura). Lo hecho se pinta en verde; lo pendiente es un botón que emite `fix` con su ancla.
 *
 * Uso: `<app-check-ring title="Account security" [status]="label()" [score]="score()" [tone]="tone()"
 *   [items]="checks()" [ready]="loaded()" (fix)="scrollTo($event)" />`
 * Sin `ready` muestra un esqueleto (para no enseñar un puntaje falso mientras carga).
 */
@Component({
  selector: 'app-check-ring',
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  host: { class: 'flex flex-col gap-4 md:flex-row md:items-center', '[attr.data-tone]': 'tone' },
  template: `
    @if (ready) {
      <div class="flex items-center gap-3">
        <div class="relative h-14 w-14 shrink-0" role="img" [attr.aria-label]="title + ' ' + score + ' percent'">
          <svg viewBox="0 0 64 64" class="h-14 w-14 -rotate-90">
            <circle cx="32" cy="32" r="26" fill="none" stroke-width="6" class="cr-track"></circle>
            <circle cx="32" cy="32" r="26" fill="none" stroke-width="6" stroke-linecap="round" class="cr-value"
              [attr.stroke-dasharray]="circumference" [attr.stroke-dashoffset]="circumference * (1 - score / 100)"></circle>
          </svg>
          <span class="absolute inset-0 grid place-items-center text-xs font-bold text-gray-900 tabular-nums">{{ score }}%</span>
        </div>
        <div>
          <p class="text-xs font-medium text-gray-500">{{ title }}</p>
          <p class="cr-label text-sm font-semibold">{{ status }}</p>
        </div>
      </div>
      <ul class="flex flex-wrap gap-2 md:ml-auto">
        @for (item of items; track item.id) {
          <li>
            @if (item.done) {
              <span class="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-700">
                <ion-icon name="checkmark-circle" class="text-sm"></ion-icon>{{ item.label }}
              </span>
            } @else {
              <button type="button" (click)="fix.emit(item.target)"
                class="inline-flex items-center gap-1.5 rounded-full border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-100">
                <ion-icon name="ellipse-outline" class="text-sm text-gray-400"></ion-icon>{{ item.label }}
                <ion-icon name="arrow-forward-outline" class="text-xs text-brand-bold"></ion-icon>
              </button>
            }
          </li>
        }
      </ul>
    } @else {
      <div class="flex items-center gap-3" aria-hidden="true">
        <div class="h-14 w-14 animate-pulse rounded-full bg-gray-100"></div>
        <div class="flex flex-col gap-2">
          <div class="h-3 w-24 animate-pulse rounded bg-gray-100"></div>
          <div class="h-3 w-32 animate-pulse rounded bg-gray-100"></div>
        </div>
      </div>
    }
  `,
  styles: `
    .cr-track {
      stroke: #e2edf7;
    }
    .cr-value {
      stroke: #1e466b;
      transition: stroke-dashoffset 900ms cubic-bezier(0.2, 0.8, 0.2, 1);
    }
    :host([data-tone='strong']) .cr-value {
      stroke: #10b981;
    }
    :host([data-tone='weak']) .cr-value {
      stroke: #f59e0b;
    }
    .cr-label {
      color: #1e466b;
    }
    :host([data-tone='strong']) .cr-label {
      color: #047857;
    }
    :host([data-tone='weak']) .cr-label {
      color: #b45309;
    }
    @media (prefers-reduced-motion: reduce) {
      .cr-value {
        transition: none;
      }
    }
  `,
})
export class CheckRingComponent {
  @Input() title = '';
  @Input() status = '';
  @Input() score = 0;
  @Input() tone: CheckRingTone = 'good';
  @Input() items: readonly CheckRingItem[] = [];
  @Input() ready = true;
  @Output() readonly fix = new EventEmitter<string>();

  /** r = 26 → circunferencia del trazo. */
  readonly circumference = 2 * Math.PI * 26;
}
