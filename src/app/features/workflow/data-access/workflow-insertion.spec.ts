import {
  WorkflowConnection,
  WorkflowStep,
  WorkflowStepTypeId,
  insertionIssue,
} from './workflow.model';

function step(id: string, typeId: WorkflowStepTypeId): WorkflowStep {
  return { id, typeId, title: id, subtitle: '', config: {} };
}

function link(id: string, fromStepId: string, toStepId: string, fromPort = 'main'): WorkflowConnection {
  return { id, fromStepId, fromPort, toStepId };
}

/**
 * Este es el contrato del menú del `+`: cada motivo de aquí es el texto que se
 * enseña en gris bajo la fila. Por eso se comprueba el TEXTO y no solo que haya
 * un problema — un motivo que no diga qué hacer en su lugar no sirve de nada.
 */
describe('insertionIssue', () => {
  it('un trigger no puede colgar de otra carta', () => {
    // Hoy nada lo impedía: se podían encadenar cinco triggers seguidos.
    const issue = insertionIssue([step('a', 'new-email')], [], 'a', 'form-submitted');
    expect(issue).toEqual({ severity: 'blocked', reason: 'Triggers can only start a flow' });
  });

  it('y un paso normal no puede ser la raíz', () => {
    const issue = insertionIssue([], [], null, 'send-email');
    expect(issue).toEqual({ severity: 'blocked', reason: 'A flow has to start with a trigger' });
  });

  it('un trigger en la raíz encaja', () => {
    expect(insertionIssue([], [], null, 'new-email')).toBeNull();
  });

  it('avisa —sin bloquear— del dato que falta, nombrándolo', () => {
    // `new-email` manda from/subject/body, pero no `email`, que es lo que
    // `send-email` necesita. Se deja insertar: es un flujo a medio montar, no
    // uno roto.
    const issue = insertionIssue([step('a', 'new-email')], [], 'a', 'send-email');
    expect(issue?.severity).toBe('warning');
    expect(issue?.reason).toBe('Needs Email, and nothing before it sends that');
  });

  it('cuenta lo que produce la carta de la que cuelga, no solo lo que le llega', () => {
    // `form-submitted` SÍ manda `email`. Como el paso nuevo se engancha
    // justo detrás, ese campo ya cuenta aunque `availableFieldsAt` mire
    // únicamente hacia atrás de la carta origen.
    expect(insertionIssue([step('a', 'form-submitted')], [], 'a', 'send-email')).toBeNull();
  });

  it('y también lo que viene de más atrás en la cadena', () => {
    const steps = [step('a', 'form-submitted'), step('b', 'delay')];
    expect(insertionIssue(steps, [link('l', 'a', 'b')], 'b', 'send-email')).toBeNull();
  });

  it('nombra el campo requerido cuando el paso anterior no lo produce', () => {
    const issue = insertionIssue([step('a', 'manual-trigger')], [], 'a', 'update-record');
    expect(issue?.reason).toBe('Needs Record id, and nothing before it sends that');
  });

  it('lo que no consume nada encaja detrás de cualquier cosa', () => {
    expect(insertionIssue([step('a', 'new-email')], [], 'a', 'delay')).toBeNull();
    expect(insertionIssue([step('a', 'new-email')], [], 'a', 'condition')).toBeNull();
  });
});
