import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { vi } from 'vitest';
import { ClientNotesStore } from '../../data-access/client-notes.store';
import { ClientNoteCard, NoteResponse, toClientNoteCard } from '../../data-access/client-notes.model';
import { ClientProfileNotesComponent } from './client-profile-notes.component';

const ME = 'user-me';
const DAY_MS = 86_400_000;

function iso(offsetMs: number): string {
  return new Date(Date.now() - offsetMs).toISOString();
}

function response(overrides: Partial<NoteResponse> & { id: string }): NoteResponse {
  const createdAtUtc = overrides.createdAtUtc ?? iso(60_000);
  return {
    tenantId: 't1',
    createdByUserId: ME,
    contentHtml: `Body of ${overrides.id}`,
    contentPreview: '',
    targetType: 'Customer',
    targetId: 'client-1',
    visibility: 'Team',
    colorKind: null,
    isPinned: false,
    status: 'Active',
    createdAtUtc,
    updatedAtUtc: createdAtUtc,
    attachments: [],
    ...overrides,
  };
}

function card(overrides: Partial<NoteResponse> & { id: string }, viewAll = false): ClientNoteCard {
  return toClientNoteCard(response(overrides), new Map([['other', 'Ana López']]), ME, viewAll);
}

function createStore(notes: ClientNoteCard[]) {
  return {
    notes: signal(notes),
    loading: signal(false),
    error: signal<string | null>(null),
    actionError: signal<string | null>(null),
    me: signal({ id: ME, name: 'Carla Gómez', avatarUrl: 'https://api.test/storage/avatars/f-me' as string | null }),
    isBusy: () => false,
    load: vi.fn(),
    refresh: vi.fn(),
    clearActionError: vi.fn(),
    create: vi.fn(() => of('new-note')),
    attachFiles: vi.fn(),
    updateContent: vi.fn(() => of(undefined)),
    togglePin: vi.fn(),
    setVisibility: vi.fn(),
    setColor: vi.fn(),
    toggleArchive: vi.fn(),
    remove: vi.fn(),
    detachAttachment: vi.fn(),
    downloadAttachment: vi.fn(),
    viewerItem: vi.fn(),
  };
}

describe('ClientProfileNotesComponent', () => {
  let store: ReturnType<typeof createStore>;

  function setup(notes: ClientNoteCard[] = []) {
    store = createStore(notes);
    TestBed.configureTestingModule({
      imports: [ClientProfileNotesComponent],
      providers: [{ provide: ClientNotesStore, useValue: store }],
    });
    const fixture = TestBed.createComponent(ClientProfileNotesComponent);
    fixture.componentInstance.clientId = 'client-1';
    fixture.componentInstance.ngOnChanges();
    fixture.detectChanges();
    document.body.appendChild(fixture.nativeElement);
    const el = fixture.nativeElement as HTMLElement;
    return { fixture, el, component: fixture.componentInstance };
  }

  function type(el: HTMLElement, text: string): HTMLTextAreaElement {
    const box = el.querySelector('textarea[aria-label="Note text"]') as HTMLTextAreaElement;
    box.value = text;
    box.dispatchEvent(new Event('input'));
    return box;
  }

  const submitButton = (el: HTMLElement) => el.querySelector('.composer-submit') as HTMLButtonElement;

  afterEach(() => {
    TestBed.resetTestingModule();
    document.querySelectorAll('[role="menu"], [role="tooltip"]').forEach(node => node.remove());
  });

  describe('composer', () => {
    it('crea la nota con el texto escapado, la visibilidad y la etiqueta, y limpia el borrador', () => {
      const { fixture, el, component } = setup();
      expect(submitButton(el).disabled).toBe(true);

      type(el, 'Called <client>\nNext: send W-2');
      component.draftVisibility.set('ClientVisible');
      component.draftColor.set('FollowUp');
      fixture.detectChanges();
      expect(submitButton(el).disabled).toBe(false);
      expect(el.querySelector('.composer-hint')?.textContent).toContain('portal');

      submitButton(el).click();
      fixture.detectChanges();

      expect(store.create).toHaveBeenCalledWith('Called &lt;client&gt;<br>Next: send W-2', 'ClientVisible', 'FollowUp');
      expect(store.attachFiles).toHaveBeenCalledWith('new-note', []);
      expect(component.draftText()).toBe('');
      expect(component.draftVisibility()).toBe('Team');
      expect(component.draftColor()).toBe('Default');
    });

    it('Ctrl+Enter (o Cmd+Enter) envía; Enter solo no', () => {
      const { el } = setup();
      const box = type(el, 'Quick note');

      box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      expect(store.create).not.toHaveBeenCalled();

      box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true }));
      expect(store.create).toHaveBeenCalledTimes(1);

      type(el, 'Another');
      box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', metaKey: true, bubbles: true }));
      expect(store.create).toHaveBeenCalledTimes(2);
    });

    it('si falla conserva el borrador y muestra el error', () => {
      const { fixture, el, component } = setup();
      store.create.mockReturnValueOnce(throwError(() => new Error('boom')));
      type(el, 'Keep me');
      fixture.detectChanges();
      submitButton(el).click();
      fixture.detectChanges();

      expect(component.draftText()).toBe('Keep me');
      expect(component.saving()).toBe(false);
      expect(el.querySelector('[role="alert"]')?.textContent).toContain('Your draft was kept');
    });

    it('encola adjuntos y los enlaza a la nota recién creada', () => {
      const { fixture, el, component } = setup();
      const file = new File(['x'], 'w2.pdf', { type: 'application/pdf' });
      const input = el.querySelector('form input[type="file"]') as HTMLInputElement;
      Object.defineProperty(input, 'files', { value: [file], configurable: true });
      input.dispatchEvent(new Event('change'));
      fixture.detectChanges();
      expect(el.querySelector('[aria-label="Files to attach"]')?.textContent).toContain('w2.pdf');

      type(el, 'With file');
      fixture.detectChanges();
      component.addNote();

      expect(store.attachFiles).toHaveBeenCalledWith('new-note', [file]);
      expect(component.draftFiles()).toEqual([]);
    });
  });

  describe('feed', () => {
    // Reloj fijo a media tarde: "Today"/"Yesterday" no dependen de la hora a la que corra el test.
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date(2026, 9, 28, 15, 0, 0));
    });
    afterEach(() => vi.useRealTimers());

    it('pinta la sección Pinned arriba y luego el feed por día, más reciente primero', () => {
      const { el } = setup([
        card({ id: 'old', createdAtUtc: iso(DAY_MS + 60_000) }),
        card({ id: 'pinned', isPinned: true, createdAtUtc: iso(3 * DAY_MS) }),
        card({ id: 'older-today', createdAtUtc: iso(120_000) }),
        card({ id: 'newest', createdAtUtc: iso(30_000) }),
      ]);

      const pinned = el.querySelector('.notes-pinned') as HTMLElement;
      expect(pinned.querySelector('h4')?.textContent).toContain('Pinned');
      expect(pinned.textContent).toContain('Body of pinned');

      const days = Array.from(el.querySelectorAll('.notes-day'));
      expect(days.map(day => day.querySelector('h4')?.textContent?.trim())).toEqual(['Today', 'Yesterday']);
      const todayBodies = Array.from(days[0].querySelectorAll('.note-body')).map(b => b.textContent);
      expect(todayBodies).toEqual(['Body of newest', 'Body of older-today']);
      // La anclada no se repite en el feed.
      expect(days.some(day => day.textContent?.includes('Body of pinned'))).toBe(false);
    });

    it('pinta la foto del autor y la mía en el composer', () => {
      const note = card({ id: 'n1', createdByUserId: 'other' });
      note.authorAvatarUrl = 'https://api.test/storage/avatars/f-ana';
      const { el } = setup([note]);

      const article = el.querySelector('article') as HTMLElement;
      expect(article.querySelector('img')?.getAttribute('src')).toBe('https://api.test/storage/avatars/f-ana');
      const sources = Array.from(el.querySelectorAll('img')).map(img => img.getAttribute('src'));
      expect(sources).toContain('https://api.test/storage/avatars/f-me');
    });

    it('muestra badge de visibilidad, etiqueta y tiempo con fecha absoluta en el title', () => {
      const { el } = setup([card({ id: 'n1', visibility: 'ClientVisible', colorKind: 'Important' })]);
      const article = el.querySelector('article') as HTMLElement;
      expect(article.textContent).toContain('Visible to client');
      expect(article.textContent).toContain('Important');
      expect(article.querySelector('.bg-red-400')).toBeTruthy();
      const time = article.querySelector('time') as HTMLElement;
      expect(time.textContent).toContain('ago');
      expect(time.getAttribute('title')).toMatch(/\d{4}/);
    });

    it('filtra por chips y por búsqueda (las archivadas solo en Archived)', () => {
      const { fixture, el, component } = setup([
        card({ id: 'a', contentHtml: 'Refund status' }),
        card({ id: 'b', visibility: 'ClientVisible', contentHtml: 'Docs received' }),
        card({ id: 'c', status: 'Archived', contentHtml: 'Old address' }),
        card({ id: 'd', isPinned: true, contentHtml: 'Prefers phone' }),
      ]);
      const bodies = () => Array.from(el.querySelectorAll('.note-body')).map(b => b.textContent);
      expect(bodies()).not.toContain('Old address');

      component.filter.set('archived');
      fixture.detectChanges();
      expect(bodies()).toEqual(['Old address']);

      component.filter.set('client');
      fixture.detectChanges();
      expect(bodies()).toEqual(['Docs received']);

      component.filter.set('all');
      component.search.set('refund');
      fixture.detectChanges();
      expect(bodies()).toEqual(['Refund status']);

      component.search.set('zzz');
      fixture.detectChanges();
      expect(el.textContent).toContain('No notes match these filters.');
    });

    it('estado vacío con app-state-block', () => {
      const { el } = setup([]);
      expect(el.textContent).toContain('No notes yet');
    });
  });

  describe('acciones de la tarjeta', () => {
    it('las acciones rápidas llevan aria-label y tooltip; el menú ⋯ agrupa el resto', () => {
      const { fixture, el } = setup([card({ id: 'mine' })]);
      const quick = Array.from(el.querySelectorAll('article .note-action')) as HTMLButtonElement[];
      expect(quick.map(b => b.getAttribute('aria-label'))).toEqual(['Pin note', 'Edit note', 'Attach files']);

      quick[0].click();
      expect(store.togglePin).toHaveBeenCalled();

      (el.querySelector('.note-menu-trigger') as HTMLButtonElement).click();
      fixture.detectChanges();
      const menu = document.querySelector('[role="menu"]') as HTMLElement;
      expect(menu.textContent).toContain('Visibility');
      expect(menu.textContent).toContain('Visible to client');
      expect(menu.textContent).toContain('Archive note');
      expect(menu.textContent).toContain('Delete note');
      expect(menu.querySelectorAll('.note-color-swatch').length).toBe(6);

      (menu.querySelector('.note-delete-item') as HTMLButtonElement).click();
      fixture.detectChanges();
      expect(fixture.componentInstance.pendingDelete()?.id).toBe('mine');
      fixture.componentInstance.confirmDelete();
      expect(store.remove).toHaveBeenCalledWith('mine');
    });

    it('el tooltip de una acción rápida aparece al pasar el ratón', () => {
      vi.useFakeTimers();
      try {
        const { el } = setup([card({ id: 'mine' })]);
        const pin = el.querySelector('article .note-action') as HTMLButtonElement;
        pin.dispatchEvent(new MouseEvent('mouseenter'));
        vi.advanceTimersByTime(350);
        expect(document.querySelector('[role="tooltip"]')?.textContent).toBe('Pin to top');
      } finally {
        vi.useRealTimers();
      }
    });

    it('nota ajena sin notes.view_all: sin acciones; con view_all solo archivar/borrar', () => {
      const { el } = setup([card({ id: 'theirs', createdByUserId: 'other' })]);
      expect(el.querySelector('article .note-action')).toBeNull();
      expect(el.querySelector('.note-menu-trigger')).toBeNull();
      expect(el.textContent).toContain('Ana López');
      TestBed.resetTestingModule();

      const managed = setup([card({ id: 'theirs', createdByUserId: 'other' }, true)]);
      (managed.el.querySelector('.note-menu-trigger') as HTMLButtonElement).click();
      managed.fixture.detectChanges();
      const menu = document.querySelector('[role="menu"]') as HTMLElement;
      expect(menu.textContent).not.toContain('Visibility');
      expect(menu.textContent).toContain('Archive note');
    });

    it('edición en línea: Esc cancela y Ctrl+Enter guarda', async () => {
      const { fixture, el } = setup([card({ id: 'mine', contentHtml: 'Line 1<br>Line 2' })]);
      const edit = () => el.querySelector('[aria-label="Edit note"]') as HTMLButtonElement;
      const box = () => el.querySelector('textarea[aria-label="Edit note"]') as HTMLTextAreaElement | null;

      edit().click();
      fixture.detectChanges();
      expect(box()?.value).toBe('Line 1\nLine 2');
      box()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      fixture.detectChanges();
      expect(box()).toBeNull();

      edit().click();
      fixture.detectChanges();
      box()!.value = 'Updated <b>';
      box()!.dispatchEvent(new Event('input'));
      box()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true }));
      fixture.detectChanges();
      expect(store.updateContent).toHaveBeenCalledWith('mine', 'Updated &lt;b&gt;');
      expect(box()).toBeNull();
    });

    it('notas largas se recortan con Show more', () => {
      const long = Array.from({ length: 10 }, (_, i) => `Line ${i}`).join('<br>');
      const { fixture, el } = setup([card({ id: 'long', contentHtml: long })]);
      const body = el.querySelector('.note-body') as HTMLElement;
      expect(body.classList.contains('line-clamp-6')).toBe(true);
      const more = el.querySelector('.note-more') as HTMLButtonElement;
      expect(more.textContent).toContain('Show more');
      more.click();
      fixture.detectChanges();
      expect(body.classList.contains('line-clamp-6')).toBe(false);
      expect(more.getAttribute('aria-expanded')).toBe('true');
    });
  });
});
