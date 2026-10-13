import { Component, CUSTOM_ELEMENTS_SCHEMA, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { SignatureStore } from '../../data-access/signature.store';
import { SignatureProfileListComponent } from '../../ui/signature-profile-list/signature-profile-list.component';

/**
 * C1 — "My Signature" del empleado: sus firmas reutilizables personales, separadas de la gobernanza
 * del despacho (que vive en Settings → Signature). Antes solo se llegaba por un modal en el header de
 * la página de solicitudes (lo quita C2).
 *
 * Acceso: el guard de ruta exige `signature.preparer.manage` (feature `my-signature`); el backend
 * cierra el resto (personal exige `sign_own`; el empleado necesita el flag del tenant). Si el despacho
 * apagó la firma propia (`canManageOwnSignature=false`), se muestra el aviso en vez de la lista — el
 * backend igual lo rechazaría. Admin siempre puede.
 */
@Component({
  selector: 'app-my-signature-page',
  imports: [RouterLink, SignatureProfileListComponent],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './my-signature-page.component.html',
})
export class MySignaturePageComponent {
  private readonly store = inject(SignatureStore);

  /** false para un empleado cuando el tenant apagó la firma propia: solo usa la de oficina. */
  readonly canManageOwn = this.store.canManageOwnSignature;

  constructor() {
    // Refresca al abrir; la lista hija solo carga en frío. También trae `canManageOwnSignature`.
    this.store.loadSignatureProfiles(true);
  }
}
