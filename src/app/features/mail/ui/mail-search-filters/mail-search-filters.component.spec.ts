import { TestBed, ComponentFixture } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  EMPTY_ADVANCED_SEARCH,
  MailAdvancedSearch,
  MailSearchFiltersComponent,
  validateAdvancedSearch,
} from './mail-search-filters.component';

describe('validateAdvancedSearch', () => {
  it('pide algún criterio de texto y 2+ caracteres en cada texto presente', () => {
    expect(validateAdvancedSearch({ ...EMPTY_ADVANCED_SEARCH, hasAttachments: true }).form).toBeTruthy();
    expect(validateAdvancedSearch({ ...EMPTY_ADVANCED_SEARCH, from: 'a' })).toMatchObject({
      from: 'Enter at least 2 characters.',
    });
    expect(validateAdvancedSearch({ ...EMPTY_ADVANCED_SEARCH, subject: 'w-2' })).toEqual({});
  });

  it('rango personalizado: al menos un extremo y en orden', () => {
    const base = { ...EMPTY_ADVANCED_SEARCH, q: 'factura', date: 'custom' as const };
    expect(validateAdvancedSearch(base).date).toBe('Pick a start or end date.');
    expect(validateAdvancedSearch({ ...base, dateFrom: '2026-10-31', dateTo: '2026-10-01' }).date).toBe(
      'The start date must be before the end date.',
    );
    expect(validateAdvancedSearch({ ...base, dateTo: '2026-10-01' })).toEqual({});
  });
});

describe('MailSearchFiltersComponent (panel de búsqueda avanzada)', () => {
  let fixture: ComponentFixture<MailSearchFiltersComponent>;
  let searched: MailAdvancedSearch[];
  let cleared: number;
  let closed: number;
  let anchor: HTMLElement;

  async function open(value: Partial<MailAdvancedSearch> = {}) {
    searched = [];
    cleared = 0;
    closed = 0;
    anchor = document.createElement('div');
    document.body.appendChild(anchor);
    TestBed.configureTestingModule({ imports: [MailSearchFiltersComponent] });
    fixture = TestBed.createComponent(MailSearchFiltersComponent);
    document.body.appendChild(fixture.nativeElement);
    const component = fixture.componentInstance;
    component.search.subscribe((v) => searched.push(v));
    component.cleared.subscribe(() => cleared++);
    component.closed.subscribe(() => {
      closed++;
      fixture.componentRef.setInput('open', false);
    });
    fixture.componentRef.setInput('anchor', anchor);
    fixture.componentRef.setInput('value', { ...EMPTY_ADVANCED_SEARCH, ...value });
    fixture.componentRef.setInput('open', true);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return component;
  }

  const dialog = () => document.body.querySelector('[role="dialog"]') as HTMLElement | null;
  const field = (label: string) => {
    const labelEl = Array.from(dialog()!.querySelectorAll('label')).find((el) => el.textContent?.trim() === label)!;
    return dialog()!.querySelector(`#${labelEl.getAttribute('for')}`) as HTMLInputElement | HTMLSelectElement;
  };
  const typeInto = (label: string, value: string) => {
    const input = field(label) as HTMLInputElement;
    input.value = value;
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  };
  const choose = (label: string, value: string) => {
    const select = field(label) as HTMLSelectElement;
    select.value = value;
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();
  };
  const button = (text: string) =>
    Array.from(dialog()!.querySelectorAll('button')).find((el) => el.textContent?.trim() === text) as HTMLButtonElement;

  beforeEach(() => TestBed.resetTestingModule());
  afterEach(() => {
    fixture?.destroy();
    fixture?.nativeElement.remove();
    anchor?.remove();
  });

  it('se porta al body como diálogo con nombre y trae los filtros aplicados', async () => {
    await open({ q: 'factura', from: 'ana@x.com', folder: 'sent', unread: true });
    const panel = dialog()!;
    expect(panel.parentElement).toBe(document.body);
    expect(fixture.nativeElement.contains(panel)).toBe(false);
    expect(panel.getAttribute('aria-modal')).toBe('true');
    expect(document.getElementById(panel.getAttribute('aria-labelledby')!)?.textContent).toBe('Search filters');
    expect((field('From') as HTMLInputElement).value).toBe('ana@x.com');
    expect((field('Keywords') as HTMLInputElement).value).toBe('factura');
    expect((field('Folder') as HTMLSelectElement).value).toBe('sent');
  });

  it('"Search" emite lo editado (recortado); con errores no emite y los muestra', async () => {
    await open();
    button('Search').click();
    fixture.detectChanges();
    expect(searched).toEqual([]);
    expect(dialog()!.textContent).toContain('Add keywords, a sender, a recipient or a subject to search.');

    typeInto('From', 'a');
    button('Search').click();
    fixture.detectChanges();
    expect(searched).toEqual([]);
    expect(field('From').getAttribute('aria-invalid')).toBe('true');

    typeInto('From', ' ana@x.com ');
    typeInto('Subject', 'w-2');
    choose('Folder', 'archived');
    const attachments = Array.from(dialog()!.querySelectorAll('input[type="checkbox"]'))[0] as HTMLInputElement;
    attachments.checked = true;
    attachments.dispatchEvent(new Event('change'));
    button('Search').click();
    expect(searched).toEqual([
      {
        ...EMPTY_ADVANCED_SEARCH,
        from: 'ana@x.com',
        subject: 'w-2',
        folder: 'archived',
        hasAttachments: true,
      },
    ]);
  });

  it('fechas: presets y rango personalizado con sus dos campos', async () => {
    await open({ q: 'factura' });
    expect(dialog()!.querySelector('input[type="date"]')).toBeNull();
    choose('Date', 'custom');
    const [since, until] = Array.from(dialog()!.querySelectorAll('input[type="date"]')) as HTMLInputElement[];
    expect(since).toBeTruthy();
    since.value = '2026-10-01';
    since.dispatchEvent(new Event('input'));
    until.value = '2026-10-31';
    until.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    button('Search').click();
    expect(searched.at(-1)).toMatchObject({ date: 'custom', dateFrom: '2026-10-01', dateTo: '2026-10-31' });

    choose('Date', '30d');
    button('Search').click();
    expect(searched.at(-1)).toMatchObject({ date: '30d', dateFrom: null, dateTo: null });
  });

  it('"Clear filters" vacía el formulario y avisa; el panel sigue abierto', async () => {
    await open({ q: 'factura', subject: 'w-2', hasAttachments: true });
    button('Clear filters').click();
    fixture.detectChanges();
    expect(cleared).toBe(1);
    expect(dialog()).not.toBeNull();
    expect((field('Keywords') as HTMLInputElement).value).toBe('');
    expect((field('Subject') as HTMLInputElement).value).toBe('');
  });

  it('Esc, la X o pulsar fuera cierran; pulsar dentro no', async () => {
    await open({ q: 'factura' });
    dialog()!.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    expect(closed).toBe(0);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    fixture.detectChanges();
    expect(closed).toBe(1);
    expect(dialog()).toBeNull();

    fixture.componentRef.setInput('open', true);
    fixture.detectChanges();
    await fixture.whenStable();
    (dialog()!.querySelector('[aria-label="Close search filters"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(closed).toBe(2);

    fixture.componentRef.setInput('open', true);
    fixture.detectChanges();
    await fixture.whenStable();
    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    fixture.detectChanges();
    expect(closed).toBe(3);
  });
});
