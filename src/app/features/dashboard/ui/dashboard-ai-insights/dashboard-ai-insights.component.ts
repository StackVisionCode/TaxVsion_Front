import { Component, CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { CommonModule } from '@angular/common';

interface AiInsight {
  title: string;
  description: string;
  icon: string;
  iconBg: string;
}

/**
 * Columna "AI Insights" (referencia "Aether"): 3 tarjetas con header gris
 * suave, icono circular de color y link "View Details". Contenido CRM estático.
 */
@Component({
  selector: 'app-dashboard-ai-insights',
  imports: [CommonModule],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './dashboard-ai-insights.component.html',
})
export class DashboardAiInsightsComponent {
  readonly insights: AiInsight[] = [
    {
      title: 'Client Behavior Trends',
      description: 'Client engagement increases consistently during the weeks before filing deadlines.',
      icon: 'time-outline',
      iconBg: 'bg-indigo-500',
    },
    {
      title: 'Risk & Anomaly Alerts',
      description: 'AI detects unusual filing patterns and alerts your team for immediate review.',
      icon: 'alert-circle-outline',
      iconBg: 'bg-orange-500',
    },
    {
      title: 'Growth Suggestions',
      description: 'AI recommends actionable improvements to increase client retention and overall growth.',
      icon: 'trending-up-outline',
      iconBg: 'bg-green-500',
    },
  ];
}
