import { Component, CUSTOM_ELEMENTS_SCHEMA, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { ApiConfigService } from '@core/config/api-config.service';
import { BrandLogoComponent } from '@core/theme/brand-logo.component';

/**
 * Puente para el enlace de descarga del correo de firma completada.
 *
 * El correo arma el link con la base del CRM (front): `{front}/storage/public/{token}?email=…`.
 * Pero `/storage/public/{token}` es un endpoint del BACKEND (CloudStorage `PublicShareController`,
 * anónimo, verifica el `?email`), no una página del front. En prod el Gateway del subdominio del
 * tenant sirve esa ruta directamente (esta página ni se carga); en DEV el front (4200) y el Gateway
 * (5047) son orígenes distintos, así que este componente recibe el enlace y **redirige** al backend.
 *
 * Guarda anti-bucle: si la URL destino queda en el MISMO origen que la actual, no redirige (evita
 * un loop si algún día el front y el backend comparten host) y ofrece el botón de descarga manual.
 */
@Component({
  selector: 'app-public-share-redirect',
  standalone: true,
  imports: [CommonModule, BrandLogoComponent],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './public-share-redirect.component.html',
})
export class PublicShareRedirectComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly api = inject(ApiConfigService);

  /** 'downloading' = descarga en curso; 'ready' = botón manual; 'error' = enlace inválido. */
  readonly state = signal<'downloading' | 'ready' | 'error'>('downloading');
  readonly heading = signal('Your document is on its way');
  readonly message = signal('We’re preparing your signed document. The download starts automatically.');
  readonly fallbackUrl = signal<string | null>(null);

  ngOnInit(): void {
    const token = this.route.snapshot.paramMap.get('token') ?? '';
    const email = this.route.snapshot.queryParamMap.get('email');
    if (!token) {
      this.fail('This download link is missing its code. Open the link exactly as it appears in the email.');
      return;
    }

    let base: string;
    try {
      base = this.api.tenantUrl(`/storage/public/${encodeURIComponent(token)}`);
    } catch {
      this.fail('We couldn’t resolve the download address. Please contact the office that sent the document.');
      return;
    }
    const target = email ? `${base}?email=${encodeURIComponent(email)}` : base;
    this.fallbackUrl.set(target);

    // Anti-bucle: si el destino cae en el mismo origen que esta página, no redirigimos solos.
    try {
      if (new URL(target).origin === window.location.origin) {
        this.state.set('ready');
        this.heading.set('Your document is ready');
        this.message.set('Tap the button below to download your signed document.');
        return;
      }
    } catch {
      this.fail('This download link looks invalid. Please contact the office that sent the document.');
      return;
    }

    window.location.replace(target);
  }

  private fail(message: string): void {
    this.state.set('error');
    this.heading.set('We couldn’t open this link');
    this.message.set(message);
  }
}
