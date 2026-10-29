import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, Signal, computed, effect, inject, signal, untracked } from '@angular/core';
import { Observable, catchError, forkJoin, map, of, switchMap, tap } from 'rxjs';
import { ApiConfigService } from '@core/config/api-config.service';
import { AuthService } from '@core/auth/auth.service';
import { AvatarUrlService } from '@core/profile-photo/avatar-url';
import { CommunicationRealtimeService } from '@core/realtime/communication-realtime.service';
import { USER_PROFILE_CHANGED_EVENT, UserProfileChangedEvent } from '@core/realtime/realtime.model';

/** Miembro del staff del tenant, resuelto para pickers y avatares (`<app-avatar [name] [seed]="userId">`). */
export interface StaffMember {
  userId: string;
  name: string;
  email: string;
  actorType: string;
  /** Puede trabajar hoy. Un suspendido conserva sus asignaciones; un retirado ya no tiene ninguna. */
  isActive: boolean;
  /** Active | Deactivated | Offboarded (espejo de Auth). */
  status: string;
  /** Foto confirmada (`/storage/avatars/{id}`); null = sin foto. */
  avatarFileId: string | null;
}

interface AuthUserRow {
  id: string;
  name: string;
  lastName: string;
  email: string;
  actorType: string;
  isActive: boolean;
  status?: string;
  avatarFileId?: string | null;
}

interface AuthUserPage {
  items: AuthUserRow[];
  totalPages: number;
}

const PAGE_SIZE = 100;

/**
 * Directorio de staff del tenant (GET /auth/users), cacheado en memoria: la fuente ÚNICA de
 * userId → nombre/foto para el resto del CRM (asignados, autores de notas, tareas, firmas…).
 * Trae el staff COMPLETO, activo y suspendido: el suspendido conserva sus clientes y sin él las
 * tarjetas decían "Unknown user". Para elegir a quién asignar se usa `assignable`.
 *
 * /auth/users exige `users.view`: sin él queda vacío y las pantallas caen a sus nombres de respaldo
 * e iniciales, sin romper nada. Las fotos se mantienen al día con `user.profile.changed` del socket
 * (lo engancha el shell con {@link startRealtime}); si soy yo, además se rehidrata la sesión (navbar).
 */
@Injectable({ providedIn: 'root' })
export class StaffDirectoryStore {
  private readonly http = inject(HttpClient);
  private readonly api = inject(ApiConfigService);
  private readonly auth = inject(AuthService);
  private readonly avatarUrls = inject(AvatarUrlService);
  private readonly realtime = inject(CommunicationRealtimeService);

  private readonly _members = signal<StaffMember[]>([]);
  private loaded = false;
  private realtimeStarted = false;

  /** Todo el staff, para poner nombre a cualquier asignación existente. */
  readonly members: Signal<StaffMember[]> = computed(() => this._members());

  /** A quién se le puede asignar un cliente hoy. */
  readonly assignable: Signal<StaffMember[]> = computed(() => this._members().filter(m => m.isActive));

  /** Índice por userId (las filas de las tablas lo consultan muchas veces por render). */
  private readonly byId = computed(() => new Map(this._members().map(m => [m.userId, m])));

  /** Oficina + usuario de la sesión: al cambiar, el directorio de la anterior no sirve. */
  private readonly scope = computed(() => {
    const user = this.auth.currentUser();
    return user ? `${user.tenant?.id}.${user.id}` : null;
  });
  private lastScope: string | null | undefined;

  constructor() {
    effect(() => {
      const scope = this.scope();
      untracked(() => {
        // Solo un cambio REAL de sesión vacía (la primera lectura únicamente la recuerda).
        if (this.lastScope !== undefined && this.lastScope !== scope) {
          this._members.set([]);
          this.loaded = false;
        }
        this.lastScope = scope;
      });
    });
  }

  /** Carga el staff una sola vez. Idempotente. */
  ensureLoaded(): void {
    if (this.loaded) {
      return;
    }
    this.loaded = true;
    this.fetch().subscribe();
  }

  /** Fuerza recarga (p.ej. tras alta/baja de un usuario). */
  reload(): void {
    this.loaded = true;
    this.fetch().subscribe();
  }

  resolve(userId: string | null | undefined): StaffMember | undefined {
    return userId ? this.byId().get(userId) : undefined;
  }

  /**
   * URL de la foto de un miembro, o null (iniciales). Lee un signal: en plantillas y `computed`
   * se re-evalúa sola cuando llega el directorio o un `user.profile.changed`.
   */
  avatarUrlFor(userId: string | null | undefined): string | null {
    return this.avatarUrls.url(this.resolve(userId)?.avatarFileId);
  }

  /** Filtro client-side por nombre/email para el picker: solo asignables. */
  search(term: string): StaffMember[] {
    const q = term.trim().toLowerCase();
    const all = this.assignable();
    return q ? all.filter(m => m.name.toLowerCase().includes(q) || m.email.toLowerCase().includes(q)) : all;
  }

  /**
   * Engancha `user.profile.changed` (idempotente; lo llama el shell al entrar). Singleton root:
   * la suscripción vive con la app.
   */
  startRealtime(): void {
    if (this.realtimeStarted) {
      return;
    }
    this.realtimeStarted = true;
    this.realtime.on<UserProfileChangedEvent>(USER_PROFILE_CHANGED_EVENT).subscribe(evt => this.applyProfileChange(evt));
  }

  /**
   * Aplica un cambio de perfil. Campo ausente = "no se sabe, se conserva"; `null` = sin foto.
   * Si el cambio es mío y la sesión aún no lo tiene, se re-pide /auth/me (navbar y perfil).
   */
  applyProfileChange(evt: UserProfileChangedEvent | null | undefined): void {
    if (!evt?.userId) {
      return;
    }
    this._members.update(list =>
      list.map(m =>
        m.userId !== evt.userId
          ? m
          : {
              ...m,
              ...(evt.avatarFileId !== undefined ? { avatarFileId: evt.avatarFileId ?? null } : {}),
              ...(evt.displayName ? { name: evt.displayName } : {}),
            },
      ),
    );

    const me = this.auth.currentUser();
    if (me?.id !== evt.userId) {
      return;
    }
    const avatarChanged = evt.avatarFileId !== undefined && (me.avatarFileId ?? null) !== (evt.avatarFileId ?? null);
    const nameChanged = !!evt.displayName && evt.displayName !== `${me.name ?? ''} ${me.lastName ?? ''}`.trim();
    if (avatarChanged || nameChanged) {
      this.auth.me().subscribe({ error: () => {} });
    }
  }

  private fetch(): Observable<StaffMember[]> {
    return this.page(1).pipe(
      switchMap(first => {
        const rest = [];
        for (let page = 2; page <= (first.totalPages ?? 1); page++) {
          rest.push(this.page(page));
        }
        return rest.length === 0 ? of([first]) : forkJoin([of(first), ...rest]);
      }),
      map(pages =>
        pages
          .flatMap(p => p.items ?? [])
          .map(toStaffMember)
          .sort((a, b) => a.name.localeCompare(b.name)),
      ),
      tap(members => this._members.set(members)),
      catchError(() => of([] as StaffMember[])),
    );
  }

  private page(page: number): Observable<AuthUserPage> {
    const params = new HttpParams().set('accountKind', 'Staff').set('page', page).set('size', PAGE_SIZE);
    return this.http.get<AuthUserPage>(this.api.tenantUrl('/auth/users'), { params });
  }
}

function toStaffMember(u: AuthUserRow): StaffMember {
  const name = `${u.name ?? ''} ${u.lastName ?? ''}`.trim() || u.email;
  return {
    userId: u.id,
    name,
    email: u.email,
    actorType: u.actorType,
    isActive: u.isActive,
    status: u.status ?? (u.isActive ? 'Active' : 'Deactivated'),
    avatarFileId: u.avatarFileId ?? null,
  };
}
