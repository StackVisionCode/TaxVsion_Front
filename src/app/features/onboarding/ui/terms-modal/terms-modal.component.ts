import { Component, CUSTOM_ELEMENTS_SCHEMA, DestroyRef, EventEmitter, Input, Output, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ModalComponent } from '@shared/ui/modal/modal.component';
import { OnboardingService } from '../../data-access/onboarding.service';
import { onboardingErrorMessage } from '../../data-access/onboarding-errors';

/**
 * Muestra el documento legal vigente sin sacar al usuario del formulario.
 *
 * El HTML viene de `GET auth/onboarding/terms/{id}/content` — un endpoint
 * público que el backend expone justamente para renderizarlo inline antes de que
 * exista ningún tenant. Es contenido propio de la plataforma, servido por
 * nuestro backend, por eso se marca como confiable; el `contentHash` que
 * acompaña a la versión es integridad, no algo para mostrar.
 *
 * Se carga perezosamente: recién al abrirse por primera vez.
 */
@Component({
  selector: 'app-terms-modal',
  imports: [CommonModule, ModalComponent],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './terms-modal.component.html',
  styleUrl: './terms-modal.component.css',
})
export class TermsModalComponent {
  private readonly onboarding = inject(OnboardingService);
  private readonly sanitizer = inject(DomSanitizer);
  private readonly destroyRef = inject(DestroyRef);

  @Input() set isOpen(value: boolean) {
    this._isOpen.set(value);
    this.loadOnce();
  }
  @Input() set termsVersionId(value: string | null) {
    this._termsVersionId = value;
    this.loadOnce();
  }
  @Input() heading = 'Terms of Service';
  @Output() closed = new EventEmitter<void>();

  private readonly _isOpen = signal(false);
  readonly open = this._isOpen.asReadonly();

  private _termsVersionId: string | null = null;

  readonly loading = signal(false);
  readonly loadError = signal<string | null>(null);
  readonly content = signal<SafeHtml | null>(null);

  private loadedFor: string | null = null;

  /**
   * Se llama desde los dos setters: el orden en que Angular asigna los inputs
   * depende de cómo estén escritos en la plantilla, así que en vez de asumir
   * uno, cada uno intenta cargar y solo procede cuando ya están las dos piezas.
   */
  private loadOnce(): void {
    const id = this._termsVersionId;
    if (!this._isOpen() || !id || this.loadedFor === id || this.loading()) {
      return;
    }
    this.loading.set(true);
    this.loadError.set(null);

    this.onboarding
      .getTermsContent(id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: html => {
          this.content.set(this.sanitizer.bypassSecurityTrustHtml(html));
          this.loadedFor = id;
          this.loading.set(false);
        },
        error: (err: unknown) => {
          this.loadError.set(onboardingErrorMessage(err));
          this.loading.set(false);
        },
      });
  }
}
