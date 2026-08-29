import { ComponentFixture, TestBed } from '@angular/core/testing';
import { UsedStorageCardComponent } from './used-storage-card.component';

const GB = 1024 ** 3;
const MB = 1024 ** 2;

/** Color gris de los puntos que representan espacio libre (privado del componente). */
const FREE_DOT_COLOR = '#EBE9F2';

/**
 * Cubre la regresión que dejaba el donut sin porcentaje.
 *
 * Los dos consumidores montan la tarjeta con `*ngIf="!usageLoading()"`, y ese
 * flag arranca en `false`: el primer render llega con `groups: []` y
 * `totalBytes: 0`. El contador se animaba una sola vez en `ngOnInit`, así que
 * quedaba fijado en el valor calculado sobre esos datos vacíos aunque después
 * llegara el uso real.
 */
describe('UsedStorageCardComponent', () => {
  let fixture: ComponentFixture<UsedStorageCardComponent>;
  let component: UsedStorageCardComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [UsedStorageCardComponent] }).compileComponents();
    fixture = TestBed.createComponent(UsedStorageCardComponent);
    component = fixture.componentInstance;
  });

  /**
   * Los inputs se fijan con `setInput` y no asignando la propiedad: asignarla a
   * mano no dispara `ngOnChanges`, que es justo el gancho donde vive el arreglo.
   */
  function setInputs(groups: { name: string; color: string; sizeBytes: number }[], totalBytes: number): void {
    fixture.componentRef.setInput('groups', groups);
    fixture.componentRef.setInput('totalBytes', totalBytes);
    fixture.detectChanges();
  }

  /** Reproduce el flujo real: primero se monta vacío, después llegan los datos. */
  function mountEmptyThenLoad(groups: { name: string; color: string; sizeBytes: number }[], totalBytes: number): void {
    setInputs([], 0);
    setInputs(groups, totalBytes);
  }

  it('sin cuota conocida no inventa un porcentaje', () => {
    setInputs([], 0);

    expect(component.hasQuota()).toBe(false);
    expect(component.displayPercent()).toBe('—');
  });

  it('refleja los datos que llegan DESPUÉS del primer render', () => {
    mountEmptyThenLoad([{ name: 'Documents', color: '#111827', sizeBytes: 150 * GB }], 200 * GB);

    expect(component.usedPercent()).toBeCloseTo(75, 5);
  });

  it('redondea a 0 cuando lo usado no llega al 1 %, sin prefijos', () => {
    mountEmptyThenLoad([{ name: 'Documents', color: '#111827', sizeBytes: 4 * MB }], 200 * GB);

    // El anillo (abajo) es lo que distingue "poco" de "nada"; el número no lleva "<".
    expect(component.displayPercent()).toBe('0');
  });

  it('colorea al menos un punto del anillo cuando hay algo guardado', () => {
    mountEmptyThenLoad([{ name: 'Documents', color: '#111827', sizeBytes: 4 * MB }], 200 * GB);

    const colored = component.outerDots().filter(dot => dot.color !== FREE_DOT_COLOR);
    expect(colored.length).toBeGreaterThanOrEqual(1);
  });

  it('deja el anillo entero en gris cuando no hay nada guardado', () => {
    setInputs([], 200 * GB);

    const colored = component.outerDots().filter(dot => dot.color !== FREE_DOT_COLOR);
    expect(colored.length).toBe(0);
    expect(component.displayPercent()).toBe('0');
  });

  it('reparte los puntos del anillo entre las categorías según su peso', () => {
    mountEmptyThenLoad(
      [
        { name: 'Documents', color: '#111827', sizeBytes: 100 * GB },
        { name: 'Images', color: '#3B82F6', sizeBytes: 100 * GB },
      ],
      200 * GB,
    );

    const dots = component.outerDots();
    const documents = dots.filter(dot => dot.color === '#111827').length;
    const images = dots.filter(dot => dot.color === '#3B82F6').length;
    const free = dots.filter(dot => dot.color === FREE_DOT_COLOR).length;

    // 100 % ocupado a partes iguales: sin puntos libres y reparto parejo.
    expect(free).toBe(0);
    expect(documents).toBe(images);
  });
});
