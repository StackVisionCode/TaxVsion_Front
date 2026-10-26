import { getComponentType } from './component-registry';
import type { ComponentType } from './components/component-type';
import type { FormComponent, FormDefinition, FormSection } from './form-definition.model';

export interface ComponentContext {
  component: FormComponent;
  section: FormSection;
  path: string;
  order: number;
  repeaterSectionId: string | null;
  componentType?: ComponentType;
}

export interface SectionContext {
  section: FormSection;
  path: string;
  order: number;
}

export interface DefinitionIndex {
  components: Map<string, ComponentContext>;
  sections: Map<string, SectionContext>;
}

export function createDefinitionIndex(definition: FormDefinition): DefinitionIndex {
  const components = new Map<string, ComponentContext>();
  const sections = new Map<string, SectionContext>();
  let order = 0;
  (definition.pages ?? []).forEach((page, pageIndex) => {
    order++;
    (page.sections ?? []).forEach((section, sectionIndex) => {
      const sectionPath = `/pages/${pageIndex}/sections/${sectionIndex}`;
      order++;
      if (!sections.has(section.id))
        sections.set(section.id, { section, path: sectionPath, order });
      (section.components ?? []).forEach((component, componentIndex) => {
        const componentPath = `${sectionPath}/components/${componentIndex}`;
        order++;
        if (!components.has(component.id)) {
          components.set(component.id, {
            component,
            section,
            path: componentPath,
            order,
            repeaterSectionId: section.repeat == null ? null : section.id,
            componentType: getComponentType(component.type),
          });
        }
      });
    });
  });
  return { components, sections };
}
