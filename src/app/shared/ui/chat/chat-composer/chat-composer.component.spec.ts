import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { describe, expect, it } from 'vitest';
import { VoiceNoteRecorderService } from '@core/communication/voice-note-recorder.service';
import { ChatComposerComponent } from './chat-composer.component';

function render(allowVoiceNotes: boolean, allowAttachments = true) {
  TestBed.configureTestingModule({
    providers: [{ provide: VoiceNoteRecorderService, useValue: { isRecording: signal(false), isSupported: true, level: signal(0), elapsedMs: signal(0) } }],
  });
  const fixture = TestBed.createComponent(ChatComposerComponent);
  fixture.componentRef.setInput('allowVoiceNotes', allowVoiceNotes);
  fixture.componentRef.setInput('allowAttachments', allowAttachments);
  fixture.detectChanges();
  return fixture.nativeElement as HTMLElement;
}

describe('ChatComposerComponent — notas de voz opcionales (F8a)', () => {
  it('por defecto, sin texto, ofrece grabar una nota de voz', () => {
    const el = render(true);
    expect(el.querySelector('[aria-label="Record voice note"]')).not.toBeNull();
  });

  it('en la sala (allowVoiceNotes=false) no hay micrófono: queda "enviar" deshabilitado hasta escribir', () => {
    const el = render(false);
    expect(el.querySelector('[aria-label="Record voice note"]')).toBeNull();
    expect((el.querySelector('[aria-label="Send message"]') as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('ChatComposerComponent — adjuntos opcionales (D-14)', () => {
  it('por defecto muestra el clip para adjuntar', () => {
    expect(render(true).querySelector('[aria-label="Attach file"]')).not.toBeNull();
  });

  it('sin permiso de adjuntar (invitado de la sala) no hay clip ni selector de archivos', () => {
    const el = render(false, false);
    expect(el.querySelector('[aria-label="Attach file"]')).toBeNull();
    expect(el.querySelector('input[type="file"]')).toBeNull();
  });
});

describe('ChatComposerComponent — tope de longitud (F8d)', () => {
  it('muestra el contador cerca de 4000 y no envía pasado el tope', () => {
    TestBed.configureTestingModule({
      providers: [{ provide: VoiceNoteRecorderService, useValue: { isRecording: signal(false), isSupported: true, level: signal(0), elapsedMs: signal(0) } }],
    });
    const fixture = TestBed.createComponent(ChatComposerComponent);
    fixture.detectChanges();
    const cmp = fixture.componentInstance;
    const sent: string[] = [];
    cmp.send.subscribe(t => sent.push(t));

    cmp.onDraftChange('a'.repeat(3600));
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[data-role="length-counter"]')?.textContent).toContain('3600/4000');

    cmp.onDraftChange('a'.repeat(4001));
    fixture.detectChanges();
    expect((el.querySelector('[aria-label="Send message"]') as HTMLButtonElement).disabled).toBe(true);
    cmp.submit();
    expect(sent).toEqual([]);
  });
});

