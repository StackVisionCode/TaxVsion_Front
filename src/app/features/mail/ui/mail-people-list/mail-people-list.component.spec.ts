import { TestBed, ComponentFixture } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MailPeopleListComponent } from './mail-people-list.component';
import { PersonSearchHit } from '../../data-access/mail.model';

const person = (over: Partial<PersonSearchHit> = {}): PersonSearchHit => ({
  address: 'ana@x.com',
  displayName: 'Ana Pérez',
  customerId: 'c1',
  messageCount: 12,
  lastContactAtUtc: '2020-03-04T10:00:00',
  direction: 'Both',
  ...over,
});

describe('MailPeopleListComponent (pestaña People)', () => {
  let fixture: ComponentFixture<MailPeopleListComponent>;
  let events: string[];

  function create(inputs: Record<string, unknown>) {
    events = [];
    TestBed.configureTestingModule({ imports: [MailPeopleListComponent] });
    fixture = TestBed.createComponent(MailPeopleListComponent);
    for (const [key, value] of Object.entries(inputs)) fixture.componentRef.setInput(key, value);
    const component = fixture.componentInstance;
    component.filterFrom.subscribe((p) => events.push(`from:${p.address}`));
    component.filterTo.subscribe((p) => events.push(`to:${p.address}`));
    component.compose.subscribe((p) => events.push(`compose:${p.address}`));
    component.openClient.subscribe((p) => events.push(`client:${p.customerId}`));
    fixture.detectChanges();
    document.body.appendChild(fixture.nativeElement);
    return component;
  }

  const rows = () => Array.from(fixture.nativeElement.querySelectorAll('li')) as HTMLElement[];
  const menuItems = () => Array.from(document.body.querySelectorAll('[role="menuitem"]')) as HTMLButtonElement[];
  const openMenu = (index = 0) => {
    (rows()[index].querySelector('[aria-haspopup="menu"]') as HTMLButtonElement).click();
    fixture.detectChanges();
  };

  beforeEach(() => TestBed.resetTestingModule());
  afterEach(() => {
    fixture?.nativeElement.remove();
    document.body.querySelectorAll('.dm-panel').forEach((el) => el.remove());
  });

  it('pinta nombre, dirección, insignia Client, último contacto y cantidad', () => {
    create({ people: [person(), person({ address: 'bob@y.com', displayName: null, customerId: null, messageCount: 1, lastContactAtUtc: null })] });
    const [ana, bob] = rows();
    expect(ana.textContent).toContain('Ana Pérez');
    expect(ana.textContent).toContain('ana@x.com');
    expect(ana.textContent).toContain('Client');
    expect(ana.textContent).toContain('Last contact Mar 4, 2020 · 12 messages');
    // Sin nombre: la dirección es el nombre (no se repite) y no hay insignia.
    expect(bob.textContent).toContain('bob@y.com');
    expect(bob.textContent).not.toContain('Client');
    expect(bob.textContent).toContain('1 message');
    expect(bob.querySelectorAll('.text-xs.text-gray-600').length).toBe(0);
  });

  it('sin nombre propio usa el nombre del cliente', () => {
    create({ people: [person({ displayName: null })], clientNames: new Map([['c1', { displayName: 'Ana (client)' }]]) });
    expect(rows()[0].textContent).toContain('Ana (client)');
  });

  it('la fila filtra From y la describe para lectores de pantalla', () => {
    create({ people: [person()] });
    const button = rows()[0].querySelector('button') as HTMLButtonElement;
    expect(button.getAttribute('aria-label')).toBe(
      'Ana Pérez, ana@x.com, client, Last contact Mar 4, 2020 · 12 messages, show emails from Ana',
    );
    button.click();
    expect(events).toEqual(['from:ana@x.com']);
  });

  it('menú: From, To, escribir y abrir ficha (solo con permiso y si es cliente)', () => {
    create({ people: [person()], canCompose: true, showClientLink: true });
    openMenu();
    const labels = menuItems().map((item) => item.textContent?.trim());
    expect(labels).toEqual(['Emails from Ana', 'Emails to Ana', 'Write an email', 'Open client profile']);
    menuItems()[1].click();
    fixture.detectChanges();
    openMenu();
    menuItems()[2].click();
    fixture.detectChanges();
    openMenu();
    menuItems()[3].click();
    expect(events).toEqual(['to:ana@x.com', 'compose:ana@x.com', 'client:c1']);
  });

  it('sin permiso de redactar ni ficha (no cliente / perfil embebido) el menú solo filtra', () => {
    create({ people: [person({ customerId: null })], canCompose: false, showClientLink: true });
    openMenu();
    expect(menuItems().map((item) => item.textContent?.trim())).toEqual(['Emails from Ana', 'Emails to Ana']);
  });

  it('`limit` recorta (bloque de All) y los estados vacío / error / cargando se pintan', () => {
    create({ people: [person(), person({ address: 'b@x.com' }), person({ address: 'c@x.com' })], limit: 2 });
    expect(rows().length).toBe(2);

    fixture.nativeElement.remove();
    TestBed.resetTestingModule();
    create({ people: [], emptyText: 'No people match "ana"' });
    expect(fixture.nativeElement.textContent).toContain('No people match "ana"');

    fixture.nativeElement.remove();
    TestBed.resetTestingModule();
    create({ people: [], emptyText: '' });
    expect(fixture.nativeElement.textContent.trim()).toBe('');

    fixture.nativeElement.remove();
    TestBed.resetTestingModule();
    create({ people: [], error: 'Search failed' });
    expect(fixture.nativeElement.textContent).toContain('Search failed');
  });
});
