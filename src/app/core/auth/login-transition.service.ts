import { DestroyRef, Injectable, inject, signal } from '@angular/core';
import {
  NavigationCancel,
  NavigationCancellationCode,
  NavigationEnd,
  NavigationError,
  Router,
} from '@angular/router';
import { Subscription } from 'rxjs';
import { prefersReducedMotion } from '@shared/utils/reduced-motion.util';

export interface LoginTransitionOptions {
  /** Texto bajo la cinta de módulos. Por defecto "Preparing your dashboard...". */
  caption?: string;
}

/**
 * Escena de transición login → dashboard (el overlay lo pinta `LoginTransitionComponent`, montado en
 * la raíz de la app). Vive en la raíz a propósito: tiene que SOBREVIVIR al cambio de ruta. Antes el
 * loader estaba dentro de la página de login y desaparecía con ella, dejando a la vista la espera del
 * guard de acceso, el primer pintado del shell y el cambio de colores del tenant.
 *
 * La enciende quien entra (login de oficina, /auth/continue, MFA, términos, takeover) con `start()`;
 * se apaga sola siguiendo el Router:
 * - `NavigationEnd` fuera de las páginas de auth → se desvanece tras el primer pintado del destino,
 *   respetando un mínimo visible para que la cinta se lea.
 * - `NavigationEnd` de vuelta en una página de auth (el guard pidió términos o alta de MFA) → se
 *   esconde YA: esas páginas son interactivas y no hay que taparlas.
 * - `NavigationCancel` por redirect de un guard o por una navegación nueva → sigue esperando (viene
 *   una navegación nueva detrás; cancelar ahí haría parpadear el login).
 * - Guard rechazado, error de navegación o nada en `MAX_VISIBLE_MS` → se esconde.
 */
@Injectable({ providedIn: 'root' })
export class LoginTransitionService {
  /** Piso: por debajo la cinta parpadearía en vez de leerse. */
  static readonly MIN_VISIBLE_MS = 900;
  static readonly REDUCED_MIN_VISIBLE_MS = 300;
  static readonly EXIT_MS = 320;
  /** Techo: un backend colgado no debe dejar al usuario mirando la escena. */
  static readonly MAX_VISIBLE_MS = 6000;
  static readonly DEFAULT_CAPTION = 'Preparing your dashboard...';

  /** Rutas que NO son un destino post-login (ver `auth.routes.ts`). */
  private static readonly AUTH_PREFIXES = [
    '/login',
    '/auth/continue',
    '/terms',
    '/client',
    '/forgot-password',
    '/find-office',
    '/office-unavailable',
    '/reset-password',
  ];

  private readonly router = inject(Router);

  private readonly _active = signal(false);
  private readonly _leaving = signal(false);
  private readonly _caption = signal(LoginTransitionService.DEFAULT_CAPTION);

  readonly active = this._active.asReadonly();
  /** Fase de salida: el overlay reproduce su fade-out y después se desmonta. */
  readonly leaving = this._leaving.asReadonly();
  readonly caption = this._caption.asReadonly();

  /** Generación: un `start()` nuevo invalida los timers/frames del anterior. */
  private run = 0;
  private startedAt = 0;
  private routerSub: Subscription | null = null;
  private readonly timers = new Set<ReturnType<typeof setTimeout>>();
  private readonly frames = new Set<number>();

  constructor() {
    inject(DestroyRef).onDestroy(() => this.teardown());
  }

  start(options?: LoginTransitionOptions): void {
    if (typeof document === 'undefined') {
      return; // SSR: no hay nada que animar
    }
    this.teardown();
    const gen = ++this.run;
    this.startedAt = this.now();
    this._caption.set(options?.caption ?? LoginTransitionService.DEFAULT_CAPTION);
    this._leaving.set(false);
    this._active.set(true);

    // `router.events` no repite: el NavigationEnd de la propia página de auth ya pasó, así que lo
    // primero que llega es la navegación que dispara quien llamó a start().
    this.routerSub = this.router.events.subscribe(event => {
      if (event instanceof NavigationEnd) {
        if (this.isAuthUrl(event.urlAfterRedirects)) {
          this.cancel();
        } else {
          this.finish(gen);
        }
      } else if (event instanceof NavigationError) {
        this.cancel();
      } else if (event instanceof NavigationCancel) {
        const keepWaiting =
          event.code === NavigationCancellationCode.Redirect ||
          event.code === NavigationCancellationCode.SupersededByNewNavigation;
        if (!keepWaiting) {
          this.cancel();
        }
      }
    });

    this.after(LoginTransitionService.MAX_VISIBLE_MS, gen, () => this.finish(gen));
  }

  /** Esconde de inmediato (vale inválido, takeover, error, guard que devuelve a auth). */
  cancel(): void {
    this.teardown();
    this._leaving.set(false);
    this._active.set(false);
  }

  /** El destino ya está activo: esperar su primer pintado, cumplir el mínimo visible y salir. */
  private finish(gen: number): void {
    if (gen !== this.run || this._leaving()) {
      return;
    }
    this.routerSub?.unsubscribe();
    this.routerSub = null;

    this.afterPaint(gen, () => {
      const reduced = prefersReducedMotion();
      const min = reduced
        ? LoginTransitionService.REDUCED_MIN_VISIBLE_MS
        : LoginTransitionService.MIN_VISIBLE_MS;
      const remaining = Math.max(0, min - (this.now() - this.startedAt));
      this.after(remaining, gen, () => {
        if (reduced) {
          this.cancel(); // sin fade: EXIT_MS = 0
          return;
        }
        this._leaving.set(true);
        this.after(LoginTransitionService.EXIT_MS, gen, () => this.cancel());
      });
    });
  }

  private isAuthUrl(url: string): boolean {
    const path = url.split(/[?#]/)[0];
    return LoginTransitionService.AUTH_PREFIXES.some(prefix => path === prefix || path.startsWith(`${prefix}/`));
  }

  /** Doble rAF: el destino recibió su primer frame pintado antes de empezar a desvanecer. */
  private afterPaint(gen: number, callback: () => void): void {
    if (typeof requestAnimationFrame !== 'function') {
      this.after(0, gen, callback);
      return;
    }
    const outer = requestAnimationFrame(() => {
      this.frames.delete(outer);
      const inner = requestAnimationFrame(() => {
        this.frames.delete(inner);
        if (gen === this.run) {
          callback();
        }
      });
      this.frames.add(inner);
    });
    this.frames.add(outer);
  }

  private after(ms: number, gen: number, callback: () => void): void {
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      if (gen === this.run) {
        callback();
      }
    }, ms);
    this.timers.add(timer);
  }

  private now(): number {
    return typeof performance !== 'undefined' ? performance.now() : Date.now();
  }

  /** Suelta la suscripción y todo lo programado. La generación la bumpea solo `start()`. */
  private teardown(): void {
    this.routerSub?.unsubscribe();
    this.routerSub = null;
    for (const timer of this.timers) {
      clearTimeout(timer);
    }
    this.timers.clear();
    if (typeof cancelAnimationFrame === 'function') {
      for (const frame of this.frames) {
        cancelAnimationFrame(frame);
      }
    }
    this.frames.clear();
  }
}
