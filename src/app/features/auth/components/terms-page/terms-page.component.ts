import { Component, DestroyRef, OnInit, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { Router } from '@angular/router';
import { forkJoin, of } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { AuthService } from '@core/auth/auth.service';
import { TokenService } from '@core/auth/token.service';
import { toApiError } from '@core/models/api-error.model';
import { ModalComponent } from '@shared/ui/modal/modal.component';

/**
 * Gate de Términos del CRM (staff). El backend bloquea (409 Terms.NotAccepted) toda llamada
 * autenticada del tenant hasta aceptar la versión vigente del ToS/AUP. El onboarding cubre la
 * PRIMERA versión; cuando se publica una nueva, el authGuard desvía aquí para que el staff la acepte.
 * Es por-tenant: una aceptación desbloquea a toda la oficina.
 *
 * Los documentos se RENDERIZAN inline (modal branded) en vez de abrir el HTML crudo de la API en
 * otra pestaña: mismo criterio que el modal de onboarding. El contenido se baja perezosamente al
 * abrir y se cachea por versión.
 */
import { BrandLogoComponent } from '@core/theme/brand-logo.component';

type TermsKind = 'TermsOfService' | 'PrivacyPolicy';

@Component({
  selector: 'app-terms-page',
  imports: [BrandLogoComponent, CommonModule, ModalComponent],
  templateUrl: './terms-page.component.html',
  styleUrl: './terms-page.component.css',
})
export class TermsPageComponent implements OnInit {
  private readonly auth = inject(AuthService);
  private readonly tokenService = inject(TokenService);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly sanitizer = inject(DomSanitizer);

  readonly agreed = signal(false);
  readonly submitting = signal(false);
  readonly formError = signal<string | null>(null);

  /** Ids de la versión vigente de cada documento (null si no se pudo resolver). */
  readonly tosVersionId = signal<string | null>(null);
  readonly privacyVersionId = signal<string | null>(null);

  // ---------- Visor inline del documento ----------
  readonly viewerOpen = signal(false);
  readonly viewerHeading = signal('Terms of Service & Acceptable Use');
  readonly viewerLoading = signal(false);
  readonly viewerError = signal<string | null>(null);
  readonly viewerContent = signal<SafeHtml | null>(null);
  /** Cache: id ya renderizado, para no re-descargar al reabrir el mismo documento. */
  private loadedFor: string | null = null;

  ngOnInit(): void {
    if (!this.tokenService.isAuthenticated()) {
      void this.router.navigate(['/login']);
      return;
    }

    forkJoin({
      tos: this.auth.currentTermsVersion('TermsOfService').pipe(catchError(() => of(null))),
      privacy: this.auth.currentTermsVersion('PrivacyPolicy').pipe(catchError(() => of(null))),
    })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(({ tos, privacy }) => {
        if (tos) {
          this.tosVersionId.set(tos.termsVersionId);
        }
        if (privacy) {
          this.privacyVersionId.set(privacy.termsVersionId);
        }
      });
  }

  /** Abre el visor y baja el documento pedido (perezoso + cacheado por versión). */
  openDocument(kind: TermsKind): void {
    const id = kind === 'TermsOfService' ? this.tosVersionId() : this.privacyVersionId();
    if (!id) {
      return;
    }
    this.viewerHeading.set(kind === 'TermsOfService' ? 'Terms of Service & Acceptable Use' : 'Privacy Policy');
    this.viewerError.set(null);
    this.viewerOpen.set(true);

    if (this.loadedFor === id) {
      return; // ya está renderizado ese documento
    }
    this.viewerContent.set(null);
    this.viewerLoading.set(true);
    this.auth
      .termsContent(id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: html => {
          // Contenido propio de la plataforma; se marca confiable tras pasar por [innerHTML] (Angular
          // igual elimina <script> etc. en el binding). Ver terms-modal del onboarding, mismo criterio.
          this.viewerContent.set(this.sanitizer.bypassSecurityTrustHtml(html));
          this.loadedFor = id;
          this.viewerLoading.set(false);
        },
        error: err => {
          this.viewerError.set(toApiError(err).message);
          this.viewerLoading.set(false);
        },
      });
  }

  closeViewer(): void {
    this.viewerOpen.set(false);
  }

  /**
   * Los enlaces del índice del documento son anclas internas (`href="#tos-1"`). Sin interceptarlos,
   * el `<a href="#…">` dispara una navegación de ruta (URL `/terms#…`) que reinicia el componente y
   * CIERRA el visor (volvías a "Review & accept"). Acá se previene esa navegación y se hace scroll
   * al destino DENTRO del panel del modal (su `overflow-y-auto`). Un enlace externo real se abre en
   * una pestaña nueva en vez de sacar al usuario del gate de aceptación.
   */
  onContentClick(event: MouseEvent): void {
    const anchor = (event.target as HTMLElement).closest('a');
    if (!anchor) {
      return;
    }
    const href = anchor.getAttribute('href') ?? '';
    if (href.startsWith('#')) {
      event.preventDefault();
      const id = href.slice(1);
      const target = id ? anchor.closest('.terms-content')?.querySelector(`#${CSS.escape(id)}`) : null;
      target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else if (/^https?:\/\//i.test(href)) {
      event.preventDefault();
      window.open(href, '_blank', 'noopener');
    }
  }

  toggleAgreed(): void {
    this.agreed.update(v => !v);
    if (this.agreed()) {
      this.formError.set(null);
    }
  }

  accept(): void {
    if (!this.agreed()) {
      this.formError.set('Please confirm you have read and agree before continuing.');
      return;
    }
    this.formError.set(null);
    this.submitting.set(true);

    this.auth
      .acceptTerms()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => void this.router.navigate(['/dashboard']),
        error: () => {
          this.submitting.set(false);
          this.formError.set("We couldn't save your acceptance. Please try again.");
        },
      });
  }

  logout(): void {
    this.auth.logoutLocal();
    void this.router.navigate(['/login']);
  }
}
