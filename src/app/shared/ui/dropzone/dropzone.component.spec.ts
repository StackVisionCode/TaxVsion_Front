import { TestBed } from '@angular/core/testing';
import { DropzoneComponent, DropzoneRejection } from './dropzone.component';

function file(name: string, size = 10): File {
  return new File([new Uint8Array(size)], name);
}

describe('DropzoneComponent', () => {
  function setup(inputs: Record<string, unknown>) {
    TestBed.configureTestingModule({ imports: [DropzoneComponent] });
    const fixture = TestBed.createComponent(DropzoneComponent);
    for (const [key, value] of Object.entries(inputs)) {
      fixture.componentRef.setInput(key, value);
    }
    fixture.detectChanges();
    const accepted: File[][] = [];
    const rejected: DropzoneRejection[][] = [];
    fixture.componentInstance.files.subscribe(f => accepted.push(f));
    fixture.componentInstance.rejected.subscribe(r => rejected.push(r));
    const el = fixture.nativeElement as HTMLElement;
    return { fixture, el, accepted, rejected };
  }

  function drop(el: HTMLElement, files: File[]): void {
    const event = new Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'dataTransfer', { value: { files } });
    el.querySelector('[appfiledrop], .border-dashed')!.dispatchEvent(event);
  }

  it('pinta label/hint y valida tipo y tamaño', () => {
    const { el, accepted, rejected } = setup({ accept: '.csv', maxBytes: 100, label: 'Drop here', hint: 'CSV only' });
    expect(el.textContent).toContain('Drop here');
    expect(el.textContent).toContain('CSV only');
    expect(el.textContent).toContain('Browse files');
    expect((el.querySelector('input[type=file]') as HTMLInputElement).getAttribute('accept')).toBe('.csv');

    drop(el, [file('ok.csv', 50), file('big.csv', 500), file('bad.exe')]);
    expect(accepted).toEqual([[expect.objectContaining({ name: 'ok.csv' })]]);
    const reasons = rejected.flat().map(r => `${r.file.name}:${r.reason}`);
    expect(reasons).toEqual(['bad.exe:type', 'big.csv:size']);
  });

  it('disabled no acepta archivos', () => {
    const { el, accepted } = setup({ disabled: true });
    drop(el, [file('a.csv')]);
    expect(accepted).toEqual([]);
    expect((el.querySelector('input[type=file]') as HTMLInputElement).disabled).toBe(true);
  });

  it('un clic en la zona abre el selector; uno en un botón proyectado no', () => {
    const { el } = setup({});
    const input = el.querySelector('input[type=file]') as HTMLInputElement;
    const opened = vi.spyOn(input, 'click');
    (el.querySelector('p') as HTMLElement).click();
    expect(opened).toHaveBeenCalledTimes(1);

    const button = document.createElement('button');
    el.querySelector('[appFileDrop], div')!.appendChild(button);
    button.click();
    expect(opened).toHaveBeenCalledTimes(1);
  });
});
