import { Component, CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AiChatComposerComponent } from '../../ui/ai-chat-composer/ai-chat-composer.component';

/**
 * Página del AI Assistant.
 *
 * NO HAY DATOS PORQUE NO HAY BACKEND: el Gateway (appsettings.json de
 * TaxVision.Gateway) no expone ningún cluster ni ruta `ai-*`, así que no existe
 * servicio de IA al que consultar. La versión anterior simulaba uno: historial
 * de conversaciones sembrado, respuestas enlatadas con orientación fiscal,
 * `setTimeout` de 900ms fingiendo latencia y un chip verde "Online". Todo eso se
 * eliminó — presentar consejo fiscal inventado como si viniera de un asistente
 * real es un riesgo para el usuario y para la firma.
 *
 * Queda una pantalla estática de "próximamente" con el composer deshabilitado.
 * La ruta (/ai-assistant) y la entrada del sidebar se conservan intactas.
 */
@Component({
  selector: 'app-ai-assistant-page',
  imports: [RouterLink, AiChatComposerComponent],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './ai-assistant-page.component.html',
})
export class AiAssistantPageComponent {}
