import { describe, expect, it, vi } from 'vitest';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { AuthService } from '@core/auth/auth.service';
import { PermissionService } from '@core/auth/permission.service';
import { CloudStorageUploadService } from '@core/cloud-storage/cloud-storage-upload.service';
import { AvatarUrlService } from '@core/profile-photo/avatar-url';
import { StaffDirectoryStore } from '@core/staff/staff-directory.store';
import { ToastService } from '@shared/ui/toast/toast.service';
import { ClientNotesService } from './client-notes.service';
import { ClientNotesStore } from './client-notes.store';
import { NoteResponse } from './client-notes.model';

function note(id: string, createdByUserId: string): NoteResponse {
  return {
    id,
    tenantId: 't1',
    createdByUserId,
    contentHtml: 'Body',
    contentPreview: '',
    targetType: 'Customer',
    targetId: 'client-1',
    visibility: 'Team',
    colorKind: null,
    isPinned: false,
    status: 'Active',
    createdAtUtc: '2026-10-28T10:00:00Z',
    updatedAtUtc: '2026-10-28T10:00:00Z',
    attachments: [],
  } as NoteResponse;
}

/** Autores y fotos salen del directorio de staff compartido; la mía, de la sesión. */
describe('ClientNotesStore — autores', () => {
  function setup() {
    const members = signal([{ userId: 'u-ana', name: 'Ana López', avatarFileId: 'f-ana' }]);
    const staff = {
      members,
      ensureLoaded: vi.fn(),
      avatarUrlFor: (id: string) => (id === 'u-ana' ? 'url:f-ana' : null),
    };
    TestBed.configureTestingModule({
      providers: [
        { provide: StaffDirectoryStore, useValue: staff },
        { provide: AvatarUrlService, useValue: { url: (id: string | null | undefined) => (id ? `url:${id}` : null) } },
        {
          provide: AuthService,
          useValue: { currentUser: signal({ id: 'u-me', name: 'Carla', lastName: 'Gómez', avatarFileId: 'f-me' }) },
        },
        { provide: PermissionService, useValue: { has: () => false } },
        {
          provide: ClientNotesService,
          useValue: { listAllByClient: () => of([note('n1', 'u-ana'), note('n2', 'u-me'), note('n3', 'u-gone')]) },
        },
        { provide: CloudStorageUploadService, useValue: {} },
        { provide: ToastService, useValue: { success: vi.fn(), error: vi.fn() } },
      ],
    });
    return { store: TestBed.inject(ClientNotesStore), staff };
  }

  it('resuelve nombre y foto del autor, y mi foto en mis notas y en el composer', () => {
    const { store, staff } = setup();
    store.load('client-1');

    expect(staff.ensureLoaded).toHaveBeenCalled();
    const byId = new Map(store.notes().map(card => [card.id, card]));
    expect(byId.get('n1')).toMatchObject({ authorName: 'Ana López', authorAvatarUrl: 'url:f-ana' });
    expect(byId.get('n2')).toMatchObject({ authorName: 'You', isMine: true, authorAvatarUrl: 'url:f-me' });
    expect(byId.get('n3')).toMatchObject({ authorName: 'Team member', authorAvatarUrl: null });
    expect(store.me()).toEqual({ id: 'u-me', name: 'Carla Gómez', avatarUrl: 'url:f-me' });
  });
});
