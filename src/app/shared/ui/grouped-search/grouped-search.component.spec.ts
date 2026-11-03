import { TestBed, ComponentFixture } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Observable, Subject, of } from 'rxjs';
import { GroupedSearchComponent } from './grouped-search.component';
import { GroupedSearchPick, GroupedSearchSuggestions } from './grouped-search.model';

describe('GroupedSearchComponent', () => {
  let fixture: ComponentFixture<GroupedSearchComponent<string>>;
  let terms: string[];
  let responses: Array<Observable<GroupedSearchSuggestions<string>>>;
  let picked: GroupedSearchPick<string>[];
  let submitted: string[];
  let chipsRemoved: string[];
  let cleared: number;

  const suggestions = (pending = false): GroupedSearchSuggestions<string> => ({
    pending,
    groups: [
      {
        id: 'clients',
        label: 'Clients',
        items: [{ id: 'c1', label: 'Ana Pérez', sublabel: 'ana@x.com', data: 'c1' }],
      },
      {
        id: 'emails',
        label: 'Emails',
        items: [
          { id: 'e1', label: 'Factura de Ana', data: 'e1' },
          { id: 'e2', label: 'Otra factura', data: 'e2' },
        ],
      },
    ],
  });

  function create(inputs: Record<string, unknown> = {}) {
    terms = [];
    responses = [];
    picked = [];
    submitted = [];
    chipsRemoved = [];
    cleared = 0;
    TestBed.configureTestingModule({ imports: [GroupedSearchComponent] });
    fixture = TestBed.createComponent(GroupedSearchComponent<string>);
    fixture.componentRef.setInput('search', (term: string) => {
      terms.push(term);
      return responses.shift() ?? of(suggestions());
    });
    for (const [key, value] of Object.entries(inputs)) {
      fixture.componentRef.setInput(key, value);
    }
    const component = fixture.componentInstance;
    component.picked.subscribe((value) => picked.push(value));
    component.submitted.subscribe((value) => submitted.push(value));
    component.chipRemoved.subscribe((value) => chipsRemoved.push(value));
    component.cleared.subscribe(() => cleared++);
    fixture.detectChanges();
    return component;
  }

  const input = () => fixture.nativeElement.querySelector('input') as HTMLInputElement;
  const options = () =>
    Array.from(fixture.nativeElement.querySelectorAll('[role="option"]')) as HTMLButtonElement[];
  const type = (value: string) => {
    input().value = value;
    input().dispatchEvent(new Event('input'));
  };
  const key = (name: string) => {
    input().dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true }));
    fixture.detectChanges();
  };

  beforeEach(() => {
    TestBed.resetTestingModule();
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  it('no busca con menos de 2 letras; con 2 o más espera la pausa y pinta los grupos con el pie', () => {
    create();
    type('f');
    vi.advanceTimersByTime(300);
    fixture.detectChanges();
    expect(terms).toEqual([]);
    expect(options().length).toBe(0);

    type('fa');
    vi.advanceTimersByTime(100);
    type('fac');
    vi.advanceTimersByTime(250);
    fixture.detectChanges();

    expect(terms).toEqual(['fac']);
    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('Clients');
    expect(text).toContain('Emails');
    expect(options().map((option) => option.textContent?.trim())).toEqual([
      expect.stringContaining('Ana Pérez'),
      expect.stringContaining('Factura de Ana'),
      expect.stringContaining('Otra factura'),
      expect.stringContaining('See all results for "fac"'),
    ]);
    // La coincidencia va resaltada (sin innerHTML).
    expect(options()[1].querySelector('mark')?.textContent).toBe('Fac');
  });

  it('muestra los grupos que van llegando y "Searching…" mientras falta alguno', () => {
    create();
    const stream = new Subject<GroupedSearchSuggestions<string>>();
    responses.push(stream);
    type('fac');
    vi.advanceTimersByTime(250);
    stream.next({ pending: true, groups: [suggestions().groups[0]] });
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Searching…');
    expect(options().length).toBe(2); // un cliente + el pie

    stream.next(suggestions(false));
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).not.toContain('Searching…');
    expect(options().length).toBe(4);
  });

  it('estado vacío honesto cuando nada coincide', () => {
    create();
    responses.push(of({ pending: false, groups: [] }));
    type('zzz');
    vi.advanceTimersByTime(250);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('No matches for "zzz"');
  });

  it('↑/↓ recorren todas las sugerencias y Enter elige la resaltada; sin resaltar, Enter confirma lo tecleado', () => {
    create();
    type('fac');
    vi.advanceTimersByTime(250);
    fixture.detectChanges();

    key('Enter');
    expect(submitted).toEqual(['fac']);

    input().dispatchEvent(new Event('focus'));
    key('ArrowDown');
    key('ArrowDown');
    expect(options()[1].getAttribute('aria-selected')).toBe('true');
    key('Enter');
    expect(picked.map((pick) => `${pick.groupId}:${pick.item.id}`)).toEqual(['emails:e1']);
  });

  it('el pie "See all results" con el teclado también confirma la búsqueda', () => {
    create();
    type('fac');
    vi.advanceTimersByTime(250);
    fixture.detectChanges();
    key('ArrowUp'); // desde nada, ↑ va al último: el pie
    key('Enter');
    expect(submitted).toEqual(['fac']);
    expect(picked).toEqual([]);
  });

  it('Esc cierra el desplegable; con él cerrado, limpia el texto y avisa', () => {
    create();
    type('fac');
    vi.advanceTimersByTime(250);
    fixture.detectChanges();
    expect(options().length).toBeGreaterThan(0);

    key('Escape');
    expect(options().length).toBe(0);
    expect(cleared).toBe(0);

    key('Escape');
    expect(input().value).toBe('');
    expect(cleared).toBe(1);
  });

  it('pinta los chips, los quita con su X o con Backspace en el input vacío', () => {
    create({ chips: [{ id: 'client', label: 'Client: Ana Pérez' }] });
    expect(fixture.nativeElement.textContent).toContain('Client: Ana Pérez');
    (
      fixture.nativeElement.querySelector(
        '[aria-label="Remove Client: Ana Pérez"]',
      ) as HTMLButtonElement
    ).click();
    key('Backspace');
    expect(chipsRemoved).toEqual(['client', 'client']);
  });

  it('con el texto vacío ofrece los grupos de reposo (p. ej. clientes recientes)', () => {
    create({
      idleGroups: [
        {
          id: 'clients',
          label: 'Recent clients',
          items: [{ id: 'c9', label: 'Luis', data: 'c9' }],
        },
      ],
    });
    input().dispatchEvent(new Event('focus'));
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Recent clients');
    options()[0].click();
    expect(picked.map((pick) => pick.item.id)).toEqual(['c9']);
  });

  it('el valor confirmado del padre se muestra y focus() lleva el foco al input', () => {
    const component = create({ value: 'w-2' });
    document.body.appendChild(fixture.nativeElement);
    expect(input().value).toBe('w-2');
    component.focus();
    expect(document.activeElement).toBe(input());
    fixture.nativeElement.remove();
  });
});
