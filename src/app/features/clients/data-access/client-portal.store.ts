import { Injectable, computed, inject, signal } from '@angular/core';
import { Observable, catchError, forkJoin, map, of, tap } from 'rxjs';
export type InviteOutcome = 'sent' | 'already-has-access';
import { toApiError } from '@core/models/api-error.model';
import { ClientPortalService } from './client-portal.service';
import {
  InvitationResponse,
  PortalAccess,
  PortalUserResponse,
  derivePortalAccess,
} from './client-portal.model';

/**
 * Store de la pestaña "Portal access" del perfil. No hay un endpoint de "estado de portal": se
 * deriva de las invitaciones + el usuario de portal del cliente (Auth, filtrados por `customerId`).
 * `providedIn: 'root'` con estado por cliente. Las lecturas toleran un 403 (permiso parcial): si
 * falta `users.invite`/`users.view`, esa lista queda vacía y el estado se deriva de lo que sí se ve.
 */
@Injectable({ providedIn: 'root' })
export class ClientPortalStore {
  private readonly service = inject(ClientPortalService);

  private customerId = '';
  private fallbackEmail = '';

  private readonly _invitations = signal<InvitationResponse[]>([]);
  private readonly _users = signal<PortalUserResponse[]>([]);
  private readonly _emailInUse = signal(false);
  private readonly _loading = signal(false);
  private readonly _error = signal<string | null>(null);

  readonly loading = this._loading.asReadonly();
  readonly error = this._error.asReadonly();
  /**
   * El email del cliente YA es un usuario de portal del tenant (aunque el usuario no esté ligado a ESTE
   * customerId). Auth dedup-ea las invitaciones por email, así que en este caso invitar es un no-op
   * silencioso → la UI muestra "already has portal access" en vez de un botón de invitar condenado.
   */
  readonly emailInUse = this._emailInUse.asReadonly();

  readonly access = computed<PortalAccess>(() =>
    derivePortalAccess(this._invitations(), this._users(), this.fallbackEmail),
  );

  load(customerId: string, email: string): void {
    if (customerId !== this.customerId) {
      this.customerId = customerId;
      this._invitations.set([]);
      this._users.set([]);
      this._emailInUse.set(false);
    }
    this.fallbackEmail = email;
    this.refresh();
  }

  refresh(): void {
    if (!this.customerId) {
      return;
    }
    this._loading.set(true);
    this._error.set(null);
    const email = (this.fallbackEmail || '').trim().toLowerCase();
    forkJoin({
      // Tolera 403 (permiso parcial): la lista que no se puede leer queda vacía.
      invitations: this.service.listInvitations(this.customerId).pipe(catchError(() => of(null))),
      users: this.service.listUsers(this.customerId).pipe(catchError(() => of(null))),
      // Detecta el email-en-uso across-tenant (independiente del customerId). Tolera 403.
      emailUsers: email ? this.service.searchUsersByEmail(email).pipe(catchError(() => of(null))) : of(null),
    }).subscribe({
      next: ({ invitations, users, emailUsers }) => {
        this._invitations.set(invitations?.items ?? []);
        this._users.set(users?.items ?? []);
        this._emailInUse.set(
          (emailUsers?.items ?? []).some(
            u => u.actorType === 'CustomerPortal' && (u.email ?? '').trim().toLowerCase() === email,
          ),
        );
        this._loading.set(false);
      },
      error: err => {
        this._error.set(toApiError(err).message);
        this._loading.set(false);
      },
    });
  }

  invite(): Observable<InviteOutcome> {
    // Si el email ya es usuario de portal del tenant, invitar sería un no-op (Auth lo descarta por email):
    // no publicamos y devolvemos el desenlace para que la UI diga "already has portal access".
    if (this._emailInUse()) {
      return of<InviteOutcome>('already-has-access');
    }
    return this.service.invite(this.customerId).pipe(
      tap(() => this.refresh()),
      map<unknown, InviteOutcome>(() => 'sent'),
    );
  }

  resend(invitationId: string): Observable<void> {
    return this.service.resendInvitation(invitationId).pipe(
      tap(() => this.refresh()),
      map(() => undefined),
    );
  }

  cancel(invitationId: string): Observable<void> {
    return this.service.cancelInvitation(invitationId).pipe(
      tap(() => this.refresh()),
      map(() => undefined),
    );
  }

  deactivate(userId: string): Observable<void> {
    return this.service.deactivateUser(userId).pipe(
      tap(() => this.refresh()),
      map(() => undefined),
    );
  }

  reactivate(userId: string): Observable<void> {
    return this.service.reactivateUser(userId).pipe(
      tap(() => this.refresh()),
      map(() => undefined),
    );
  }
}
