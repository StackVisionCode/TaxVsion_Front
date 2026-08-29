import { ComponentFixture, TestBed } from '@angular/core/testing';
import { WorkflowNodeComponent } from './workflow-node.component';
import { PositionedNode } from '../../utils/workflow-layout.util';
import { WorkflowStep } from '../../data-access/workflow.model';

function node(x: number, y: number): PositionedNode {
  const step: WorkflowStep = {
    id: 'a',
    typeId: 'send-email',
    title: 'Send Welcome Email',
    subtitle: 'Introduce product',
    parentId: null,
    branch: null,
    config: {},
  };
  return { step, x, y, width: 284, height: 96, branch: null };
}

/**
 * Cubre la regresión que dejó todos los nodos apilados en el (0,0).
 *
 * La tarjeta se posiciona con `transform: translate3d`, y la animación de
 * entrada también interpola `transform`. Al estar ambas en el MISMO elemento,
 * la animación —que gana al estilo inline y usa `fill-mode: both`— terminaba
 * en `scale(1)` y se comía el desplazamiento. Por eso posición y animación
 * viven en capas distintas: `.wf-node` coloca, `.wf-node__card` anima.
 */
describe('WorkflowNodeComponent', () => {
  let fixture: ComponentFixture<WorkflowNodeComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [WorkflowNodeComponent] }).compileComponents();
    fixture = TestBed.createComponent(WorkflowNodeComponent);
  });

  function render(x: number, y: number) {
    fixture.componentRef.setInput('node', node(x, y));
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  it('coloca la tarjeta con translate3d en las coordenadas del layout', () => {
    const host = render(320, 240);
    const positioned = host.querySelector('.wf-node') as HTMLElement;

    expect(positioned).not.toBeNull();
    expect(positioned.style.transform).toContain('320px');
    expect(positioned.style.transform).toContain('240px');
  });

  it('mantiene la animación FUERA del elemento que posiciona', () => {
    const host = render(100, 100);
    const positioned = host.querySelector('.wf-node') as HTMLElement;
    const card = host.querySelector('.wf-node__card');

    // Si la tarjeta animada y la posicionada volvieran a ser el mismo
    // elemento, la animación pisaría el translate3d y los nodos se apilarían.
    expect(card).not.toBeNull();
    expect(card).not.toBe(positioned);
  });

  it('respeta el alto que impone el layout', () => {
    const host = render(0, 0);
    const positioned = host.querySelector('.wf-node') as HTMLElement;

    expect(positioned.style.height).toBe('96px');
    expect(positioned.style.width).toBe('284px');
  });
});
