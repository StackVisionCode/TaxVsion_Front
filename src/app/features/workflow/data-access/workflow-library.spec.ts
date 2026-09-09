import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WorkflowLibraryService } from './workflow-library.service';
import { WorkflowDoc } from './workflow.model';

function doc(over: Partial<WorkflowDoc> = {}): WorkflowDoc {
  return {
    id: 'wf-1',
    name: 'Onboarding',
    steps: [{ id: 's1', typeId: 'schedule', title: 'r', subtitle: '', config: {} }],
    connections: [],
    annotations: [],
    collaborators: [],
    updatedAtIso: '2026-03-01T10:00:00.000Z',
    ...over,
  };
}

function build(): WorkflowLibraryService {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({ providers: [WorkflowLibraryService] });
  return TestBed.inject(WorkflowLibraryService);
}

describe('WorkflowLibraryService', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  it('guarda varios workflows a la vez: renombrar ya no pisa el anterior', () => {
    // El bug de origen: TODO vivía en la clave fija `tvf.workflow.v1`, así que el segundo
    // documento sobrescribía al primero y el anterior no se podía recuperar.
    const library = build();
    library.write(doc({ id: 'wf-1', name: 'Onboarding' }));
    library.write(doc({ id: 'wf-2', name: 'Renovaciones' }));

    expect(library.items().map(item => item.name).sort()).toEqual(['Onboarding', 'Renovaciones']);
    expect(library.read('wf-1')!.name).toBe('Onboarding');
    expect(library.read('wf-2')!.name).toBe('Renovaciones');
  });

  it('sube el workflow del formato viejo y deja de resucitarlo', () => {
    localStorage.setItem('tvf.workflow.v1', JSON.stringify(doc({ id: 'legacy', name: 'El de antes' })));

    const library = build();
    expect(library.read('legacy')!.name).toBe('El de antes');
    // La clave vieja se retira: si no, cada arranque volvería a insertarlo.
    expect(localStorage.getItem('tvf.workflow.v1')).toBeNull();

    // Y no reaparece en el siguiente arranque.
    expect(build().items().filter(item => item.id === 'legacy').length).toBe(1);
  });

  it('lista lo más reciente primero', () => {
    const library = build();
    library.write(doc({ id: 'viejo', name: 'Viejo', updatedAtIso: '2026-01-01T00:00:00.000Z' }));
    library.write(doc({ id: 'nuevo', name: 'Nuevo', updatedAtIso: '2026-06-01T00:00:00.000Z' }));

    expect(library.items()[0].name).toBe('Nuevo');
  });

  it('el resumen cuenta lo que la tabla enseña', () => {
    const library = build();
    library.write(
      doc({
        steps: [
          { id: 'a', typeId: 'schedule', title: 'a', subtitle: '', config: {} },
          { id: 'b', typeId: 'send-email', title: 'b', subtitle: '', config: {} },
        ],
        connections: [{ id: 'c', fromStepId: 'a', fromPort: 'main', toStepId: 'b' }],
        annotations: [{ id: 'n', kind: 'note', x: 0, y: 0, width: 10, height: 10 }],
        collaborators: [{ userId: 'u1', name: 'Ana', email: 'a@x.com', role: 'owner' }],
      }),
    );

    expect(library.items()[0]).toMatchObject({
      stepCount: 2,
      connectionCount: 1,
      annotationCount: 1,
      collaboratorCount: 1,
    });
  });

  it('duplicar copia el contenido con id y nombre nuevos', () => {
    const library = build();
    library.write(doc({ id: 'wf-1', name: 'Onboarding' }));

    const copy = library.duplicate('wf-1')!;
    expect(copy.id).not.toBe('wf-1');
    expect(copy.name).toBe('Onboarding (copy)');
    expect(copy.steps).toEqual(library.read('wf-1')!.steps);
    expect(library.items().length).toBe(2);
  });

  it('borrar quita el documento y su fila', () => {
    const library = build();
    library.write(doc({ id: 'wf-1' }));
    library.remove('wf-1');

    expect(library.read('wf-1')).toBeNull();
    expect(library.items().length).toBe(0);
  });

  it('con el índice corrupto lo reconstruye de los documentos, sin perder nada', () => {
    const library = build();
    library.write(doc({ id: 'wf-1', name: 'Onboarding' }));
    localStorage.setItem('tvf.workflows.index.v1', '{no es json');

    // El índice es una caché: la fuente de verdad son las claves de documento.
    expect(build().items().map(item => item.name)).toEqual(['Onboarding']);
  });
});
