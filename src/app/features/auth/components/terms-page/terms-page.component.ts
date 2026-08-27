import { Component, DestroyRef, OnInit, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { forkJoin, of } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { AuthService } from '@core/auth/auth.service';
import { TokenService } from '@core/auth/token.service';

/**
 * Gate de Términos del CRM (staff). El backend bloquea (409 Terms.NotAccepted) toda llamada
 * autenticada del tenant hasta aceptar la versión vigente del ToS/AUP. El onboarding cubre la
 * PRIMERA versión; cuando se publica una nueva, el authGuard desvía aquí para que el staff la acepte.
 * Es por-tenant: una aceptación desbloquea a toda la oficina.
 */
@Component({
  selector: 'app-terms-page',
  imports: [CommonModule],
  templateUrl: './terms-page.component.html',
})
export class TermsPageComponent implements OnInit {
  private readonly auth = inject(AuthService);
  private readonly tokenService = inject(TokenService);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  readonly agreed = signal(false);
  readonly submitting = signal(false);
  readonly formError = signal<string | null>(null);
  readonly tosUrl = signal<string | null>(null);
  readonly privacyUrl = signal<string | null>(null);

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
          this.tosUrl.set(this.auth.termsContentUrl(tos.termsVersionId));
        }
        if (privacy) {
          this.privacyUrl.set(this.auth.termsContentUrl(privacy.termsVersionId));
        }
      });
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
