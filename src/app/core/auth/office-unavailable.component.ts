import { Component } from '@angular/core';
import { environment } from '@env/environment';

/**
 * Mensaje plano cuando el subdominio no corresponde a una oficina registrada. Reemplaza el viejo
 * redirect a app/find-office: ahora el Gateway ya bloquea el subdominio no registrado (TenantHostGuard),
 * y el front solo muestra un mensaje genérico. No expone el status ni el cuerpo del error de la API.
 */
@Component({
  selector: 'app-office-unavailable',
  standalone: true,
  template: `
    <div class="ou-wrap">
      <div class="ou-card">
        <div class="ou-icon">🏢</div>
        <h1 class="ou-title">This office isn't available</h1>
        <p class="ou-text">
          The address you entered doesn't match an active office. Please check the link, or contact
          your administrator for the correct address.
        </p>
        <a class="ou-link" [href]="'https://app.' + baseDomain">Go to homepage</a>
      </div>
    </div>
  `,
  styles: [`
    .ou-wrap { min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 24px; background: #f8fafc; }
    .ou-card { max-width: 420px; width: 100%; text-align: center; background: #fff; border: 1px solid #e2e8f0; border-radius: 16px; padding: 40px 28px; box-shadow: 0 10px 30px rgba(2,6,23,.06); }
    .ou-icon { font-size: 44px; line-height: 1; margin-bottom: 16px; }
    .ou-title { font-size: 20px; font-weight: 700; color: #0f172a; margin: 0 0 10px; }
    .ou-text { font-size: 14px; color: #475569; line-height: 1.6; margin: 0 0 24px; }
    .ou-link { display: inline-block; font-size: 14px; font-weight: 600; color: #4f46e5; text-decoration: none; padding: 10px 20px; border: 1px solid #c7d2fe; border-radius: 10px; transition: background .15s; }
    .ou-link:hover { background: #eef2ff; }
  `],
})
export class OfficeUnavailableComponent {
  readonly baseDomain = environment.baseDomain;
}
