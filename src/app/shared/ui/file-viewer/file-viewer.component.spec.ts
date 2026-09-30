import { ComponentFixture, TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { of } from 'rxjs';
import { FileViewerComponent } from './file-viewer.component';
import { FileViewerItem } from './file-viewer.model';

/**
 * El visor se abre por `isOpen` + `files` + `startIndex`. Lo que se prueba acá es la navegación,
 * el teclado, la resolución perezosa de la URL y el fallback: pdf.js no se ejerce (lo cubre el
 * render real en el navegador).
 */
describe('FileViewerComponent', () => {
  let fixture: ComponentFixture<FileViewerComponent>;
  let component: FileViewerComponent;
  let fetchMock: ReturnType<typeof vi.fn>;

  const text = (name: string, extra: Partial<FileViewerItem> = {}): FileViewerItem => ({
    name,
    contentType: 'text/plain',
    url: `https://files.test/${name}`,
    ...extra,
  });

  beforeEach(async () => {
    fetchMock = vi.fn(async () => new Response('hello world', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await TestBed.configureTestingModule({ imports: [FileViewerComponent] }).compileComponents();
    fixture = TestBed.createComponent(FileViewerComponent);
    component = fixture.componentInstance;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.style.overflow = '';
  });

  function open(files: FileViewerItem[], startIndex = 0): void {
    fixture.componentRef.setInput('files', files);
    fixture.componentRef.setInput('startIndex', startIndex);
    fixture.componentRef.setInput('isOpen', true);
    fixture.detectChanges();
  }

  async function settle(): Promise<void> {
    for (let i = 0; i < 5; i++) {
      await Promise.resolve();
      await new Promise(resolve => setTimeout(resolve));
    }
    fixture.detectChanges();
  }

  function press(key: string, init: KeyboardEventInit = {}): void {
    document.dispatchEvent(new KeyboardEvent('keydown', { key, ...init }));
    fixture.detectChanges();
  }

  it('renders nothing while closed', () => {
    fixture.componentRef.setInput('files', [text('a.txt')]);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('[role="dialog"]')).toBeNull();
  });

  it('opens on the start index and shows the text content', async () => {
    open([text('a.txt'), text('b.txt')], 1);
    await settle();

    expect(component.current()?.name).toBe('b.txt');
    expect(fetchMock).toHaveBeenCalledWith('https://files.test/b.txt', expect.anything());
    expect(fixture.nativeElement.textContent).toContain('hello world');
    expect(component.subtitle()).toContain('2 of 2');
  });

  it('locks the page scroll while open and restores it on close', async () => {
    open([text('a.txt')]);
    expect(document.body.style.overflow).toBe('hidden');

    fixture.componentRef.setInput('isOpen', false);
    fixture.detectChanges();
    expect(document.body.style.overflow).toBe('');
  });

  it('navigates between files with the arrows and emits indexChange', async () => {
    const changes: number[] = [];
    component.indexChange.subscribe(index => changes.push(index));
    open([text('a.txt'), text('b.txt'), text('c.txt')]);
    await settle();

    press('ArrowRight');
    press('ArrowRight');
    press('ArrowRight'); // no hay vuelta al principio
    expect(component.index()).toBe(2);
    expect(changes).toEqual([1, 2]);

    press('ArrowLeft');
    expect(component.index()).toBe(1);
  });

  it('closes with Escape', () => {
    const closed = vi.fn();
    component.closed.subscribe(closed);
    open([text('a.txt')]);

    press('Escape');

    expect(closed).toHaveBeenCalledTimes(1);
  });

  it('resolves the URL lazily, only for the file being shown', async () => {
    const resolveA = vi.fn(() => of('https://files.test/a'));
    const resolveB = vi.fn(() => Promise.resolve('https://files.test/b'));
    open([
      { name: 'a.txt', contentType: 'text/plain', resolveUrl: resolveA },
      { name: 'b.txt', contentType: 'text/plain', resolveUrl: resolveB },
    ]);
    await settle();

    expect(resolveA).toHaveBeenCalledTimes(1);
    expect(resolveB).not.toHaveBeenCalled();

    component.go(1);
    await settle();
    expect(resolveB).toHaveBeenCalledTimes(1);
  });

  it('shows the fallback card without downloading unsupported files', async () => {
    open([{ name: 'return.docx', url: 'https://files.test/return.docx' }]);
    await settle();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(fixture.nativeElement.textContent).toContain('No preview available');
  });

  it('shows an error state when the file cannot be fetched', async () => {
    fetchMock.mockResolvedValueOnce(new Response('', { status: 403 }));
    open([text('a.txt')]);
    await settle();

    expect(component.state()).toBe('error');
    expect(fixture.nativeElement.textContent).toContain("We couldn't load this preview");
  });

  it('renders a CSV as a table', async () => {
    fetchMock.mockResolvedValueOnce(new Response('name,email\nJane,jane@x.com\n', { status: 200 }));
    open([{ name: 'clients.csv', url: 'https://files.test/clients.csv' }]);
    await settle();

    const cells = Array.from(fixture.nativeElement.querySelectorAll('td')).map(td => (td as HTMLElement).textContent?.trim());
    expect(cells).toEqual(['name', 'email', 'Jane', 'jane@x.com']);
  });

  it('delegates the download to the parent when it listens', async () => {
    const downloads: unknown[] = [];
    component.download.subscribe(event => downloads.push(event));
    const item = text('a.txt', { ref: 'file-1' });
    open([item]);
    await settle();

    await component.onDownload();

    expect(downloads).toEqual([{ item, index: 0 }]);
  });

  it('hides every download button when downloads are not allowed', async () => {
    fixture.componentRef.setInput('allowDownload', false);
    open([{ name: 'return.docx', url: 'https://files.test/return.docx' }]);
    await settle();

    const labels = Array.from(fixture.nativeElement.querySelectorAll('button')).map(b => (b as HTMLElement).textContent ?? '');
    expect(labels.some(label => label.includes('Download'))).toBe(false);
  });
});
