import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { vi } from 'vitest';
import { FileViewerComponent } from './file-viewer.component';
import { FileViewerDownload, FileViewerItem } from './file-viewer.model';

@Component({
  imports: [FileViewerComponent],
  template: `
    <button id="trigger" type="button">open</button>
    <app-file-viewer [isOpen]="open()" [files]="files()" [startIndex]="start()" [allowDownload]="allowDownload()"
      (closed)="open.set(false); closedCount = closedCount + 1" (indexChange)="indexes.push($event)" />
  `,
})
class HostComponent {
  readonly open = signal(false);
  readonly files = signal<FileViewerItem[]>([]);
  readonly start = signal(0);
  readonly allowDownload = signal(true);
  closedCount = 0;
  indexes: number[] = [];
}

@Component({
  imports: [FileViewerComponent],
  template: `<app-file-viewer [isOpen]="true" [files]="files" (download)="events.push($event)" (closed)="0" />`,
})
class DownloadHostComponent {
  files: FileViewerItem[] = [{ name: 'contract.docx', url: 'https://example.test/a', ref: 'file-1' }];
  events: FileViewerDownload[] = [];
}

/** Espera a que se resuelvan las promesas de carga (fetch → blob → text). */
async function settle(fixture: ComponentFixture<unknown>): Promise<void> {
  for (let i = 0; i < 6; i++) {
    await new Promise(resolve => setTimeout(resolve, 0));
    fixture.detectChanges();
  }
}

function key(name: string, init: KeyboardEventInit = {}): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true, ...init });
  document.body.dispatchEvent(event);
  return event;
}

describe('FileViewerComponent', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    fetchMock = vi.fn(async (url: string) => {
      if (url.includes('missing')) {
        return new Response('nope', { status: 404 });
      }
      if (url.includes('broken')) {
        throw new TypeError('Failed to fetch');
      }
      const body = url.includes('.csv') ? 'a,b\n1,2' : 'hello world';
      return new Response(body, { status: 200 });
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    document.body.style.overflow = '';
  });

  function setup(files: FileViewerItem[]) {
    TestBed.configureTestingModule({ imports: [HostComponent] });
    const fixture = TestBed.createComponent(HostComponent);
    fixture.componentInstance.files.set(files);
    fixture.detectChanges();
    // El overlay se porta al <body>: se consulta el documento entero.
    return { fixture, host: fixture.componentInstance, el: document.body };
  }

  const textFiles: FileViewerItem[] = [
    { name: 'notes.txt', url: 'https://example.test/notes.txt', sizeBytes: 2048 },
    { name: 'data.csv', resolveUrl: () => of('https://example.test/data.csv') },
    { name: 'report.xlsx', resolveUrl: () => Promise.resolve('https://example.test/report.xlsx') },
  ];

  it('cerrado no pinta nada; al abrir muestra el diálogo (portado al body), bloquea el scroll y carga', async () => {
    const { fixture, host, el } = setup(textFiles);
    expect(el.querySelector('[role="dialog"]')).toBeNull();

    host.open.set(true);
    fixture.detectChanges();
    const dialog = el.querySelector('[role="dialog"]');
    expect(dialog?.getAttribute('aria-modal')).toBe('true');
    expect(dialog?.parentElement).toBe(document.body);
    expect(document.body.style.overflow).toBe('hidden');

    await settle(fixture);
    expect(fetchMock).toHaveBeenCalledWith('https://example.test/notes.txt', { credentials: 'omit' });
    expect(el.querySelector('pre')?.textContent).toContain('hello world');
    expect(el.textContent).toContain('notes.txt');
    expect(el.textContent).toContain('2 KB');
    expect(el.textContent).toContain('1 of 3');
  });

  it('Esc cierra, libera el scroll y devuelve el foco al disparador', async () => {
    const { fixture, host, el } = setup(textFiles);
    const trigger = el.querySelector<HTMLButtonElement>('#trigger')!;
    trigger.focus();
    host.open.set(true);
    fixture.detectChanges();
    await settle(fixture);

    const esc = key('Escape');
    fixture.detectChanges();
    expect(esc.defaultPrevented).toBe(true);
    expect(host.closedCount).toBe(1);
    expect(el.querySelector('[role="dialog"]')).toBeNull();
    expect(document.body.style.overflow).toBe('');
    expect(document.activeElement).toBe(trigger);
  });

  it('navega entre archivos con los botones y con ←/→ (resolveUrl Observable y Promise)', async () => {
    const { fixture, host, el } = setup(textFiles);
    host.open.set(true);
    fixture.detectChanges();
    await settle(fixture);

    el.querySelector<HTMLButtonElement>('[aria-label="Next file"]')!.click();
    await settle(fixture);
    expect(host.indexes).toEqual([1]);
    expect(el.querySelectorAll('tr').length).toBe(2);
    expect(el.textContent).toContain('2 of 3');

    key('ArrowRight');
    await settle(fixture);
    expect(host.indexes).toEqual([1, 2]);
    // Tipo no soportado: tarjeta con Download, sin bajar el archivo.
    expect(el.textContent).toContain('No preview available');
    expect(fetchMock).not.toHaveBeenCalledWith('https://example.test/report.xlsx', expect.anything());
    expect(el.querySelector<HTMLButtonElement>('[aria-label="Next file"]')!.disabled).toBe(true);

    key('ArrowLeft', { altKey: true });
    await settle(fixture);
    expect(host.indexes).toEqual([1, 2, 1]);
  });

  it('abre en startIndex', async () => {
    const { fixture, host, el } = setup(textFiles);
    host.start.set(1);
    host.open.set(true);
    fixture.detectChanges();
    await settle(fixture);
    expect(el.textContent).toContain('data.csv');
  });

  it('error HTTP → mensaje legible con Retry y Download; Retry vuelve a intentar', async () => {
    const { fixture, host, el } = setup([{ name: 'gone.pdf', url: 'https://example.test/missing.pdf' }]);
    host.open.set(true);
    fixture.detectChanges();
    await settle(fixture);

    expect(el.textContent).toContain("We couldn't find this file");
    expect(el.textContent).toContain('Download instead');
    const calls = fetchMock.mock.calls.length;
    const retry = Array.from(el.querySelectorAll('button')).find(b => b.textContent?.trim() === 'Retry')!;
    retry.click();
    await settle(fixture);
    expect(fetchMock.mock.calls.length).toBe(calls + 1);
  });

  it('error de red → mensaje genérico, nunca el texto técnico', async () => {
    const { fixture, host, el } = setup([{ name: 'x.txt', url: 'https://example.test/broken.txt' }]);
    host.open.set(true);
    fixture.detectChanges();
    await settle(fixture);
    expect(el.textContent).toContain("We couldn't load this preview.");
    expect(el.textContent).not.toContain('Failed to fetch');
  });

  it('allowDownload=false oculta las descargas', async () => {
    const { fixture, host, el } = setup([{ name: 'report.xlsx', url: 'https://example.test/r' }]);
    host.allowDownload.set(false);
    host.open.set(true);
    fixture.detectChanges();
    await settle(fixture);
    expect(Array.from(el.querySelectorAll('button')).some(b => b.textContent?.includes('Download'))).toBe(false);
  });

  it('con listener de (download) el visor delega la descarga en el padre', async () => {
    TestBed.configureTestingModule({ imports: [DownloadHostComponent] });
    const fixture = TestBed.createComponent(DownloadHostComponent);
    fixture.detectChanges();
    await settle(fixture);
    const el = document.body;
    el.querySelector<HTMLButtonElement>('[aria-label="Download"]')!.click();
    expect(fixture.componentInstance.events.length).toBe(1);
    expect(fixture.componentInstance.events[0].item.ref).toBe('file-1');
    expect(fixture.componentInstance.events[0].index).toBe(0);
  });
});
