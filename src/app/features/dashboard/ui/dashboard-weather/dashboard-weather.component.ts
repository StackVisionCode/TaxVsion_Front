import { Component, CUSTOM_ELEMENTS_SCHEMA, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';

/**
 * Static placeholder weather widget. The original pulled live conditions from
 * the Open-Meteo API plus a browser-geolocation permission flow tied to
 * LoginService (personal/company address fallback); none of that survives
 * here. The location is a hardcoded city and the 7-day + hourly forecast is a
 * fixed, realistic dataset generated once at construction time. The
 * "day -> detail modal" interaction (openDetailModal/closeDetailModal) is
 * purely local UI behavior and is kept fully working against that static data.
 */
interface WeatherLocation {
  city: string;
  state: string;
}

interface CurrentWeather {
  temperature: number;
  apparentTemperature: number;
  weatherCode: number;
  weatherDescription: string;
  windSpeed: number;
  windDirection: number;
  humidity: number;
  isDay: boolean;
}

interface HourlyForecast {
  time: string;
  temperature: number;
  weatherCode: number;
  precipitation: number;
}

interface DailyForecast {
  date: string;
  temperatureMax: number;
  temperatureMin: number;
  weatherCode: number;
  weatherDescription: string;
  precipitationSum: number;
  precipitationProbability: number;
  windSpeedMax: number;
  sunrise: string;
  sunset: string;
  uvIndexMax: number;
}

interface WeatherData {
  location: WeatherLocation;
  current: CurrentWeather;
  hourly: HourlyForecast[];
  daily: DailyForecast[];
  lastUpdated: Date;
}

type DailyTemplate = Omit<DailyForecast, 'date' | 'sunrise' | 'sunset'>;

const DAILY_TEMPLATE: DailyTemplate[] = [
  { weatherCode: 0, weatherDescription: 'Clear sky', temperatureMax: 86, temperatureMin: 74, precipitationSum: 0, precipitationProbability: 5, windSpeedMax: 14, uvIndexMax: 9 },
  { weatherCode: 2, weatherDescription: 'Partly cloudy', temperatureMax: 84, temperatureMin: 73, precipitationSum: 0.1, precipitationProbability: 15, windSpeedMax: 12, uvIndexMax: 8 },
  { weatherCode: 61, weatherDescription: 'Slight rain', temperatureMax: 79, temperatureMin: 71, precipitationSum: 0.6, precipitationProbability: 70, windSpeedMax: 16, uvIndexMax: 4 },
  { weatherCode: 95, weatherDescription: 'Thunderstorm', temperatureMax: 77, temperatureMin: 70, precipitationSum: 1.2, precipitationProbability: 85, windSpeedMax: 22, uvIndexMax: 3 },
  { weatherCode: 3, weatherDescription: 'Overcast', temperatureMax: 80, temperatureMin: 72, precipitationSum: 0.05, precipitationProbability: 20, windSpeedMax: 10, uvIndexMax: 5 },
  { weatherCode: 80, weatherDescription: 'Slight rain showers', temperatureMax: 81, temperatureMin: 72, precipitationSum: 0.4, precipitationProbability: 55, windSpeedMax: 13, uvIndexMax: 6 },
  { weatherCode: 1, weatherDescription: 'Mainly clear', temperatureMax: 85, temperatureMin: 75, precipitationSum: 0, precipitationProbability: 5, windSpeedMax: 9, uvIndexMax: 9 },
];

function buildDailyForecast(): DailyForecast[] {
  const today = new Date();
  return DAILY_TEMPLATE.map((entry, index) => {
    const date = new Date(today);
    date.setDate(date.getDate() + index);
    const dateStr = date.toISOString().split('T')[0];
    return {
      ...entry,
      date: dateStr,
      sunrise: `${dateStr}T06:47:00`,
      sunset: `${dateStr}T19:52:00`,
    };
  });
}

function buildHourlyForecast(daily: DailyForecast[]): HourlyForecast[] {
  const hourly: HourlyForecast[] = [];
  daily.forEach(day => {
    const range = day.temperatureMax - day.temperatureMin;
    for (let hour = 0; hour < 24; hour++) {
      // Bell curve peaking mid-afternoon so the hourly breakdown looks plausible.
      const swing = Math.sin(((hour - 6) / 24) * Math.PI * 2);
      const temperature = Math.round(day.temperatureMin + (range * (swing + 1)) / 2);
      hourly.push({
        time: `${day.date}T${hour.toString().padStart(2, '0')}:00:00`,
        temperature,
        weatherCode: day.weatherCode,
        precipitation: hour % 6 === 0 ? Number((day.precipitationSum / 6).toFixed(2)) : 0,
      });
    }
  });
  return hourly;
}

@Component({
  selector: 'app-dashboard-weather',
  imports: [CommonModule],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './dashboard-weather.component.html',
  styleUrl: './dashboard-weather.component.scss',
})
export class DashboardWeatherComponent {
  private readonly daily = buildDailyForecast();

  readonly weatherData = signal<WeatherData>({
    location: { city: 'Miami', state: 'Florida' },
    current: {
      temperature: 86,
      apparentTemperature: 90,
      weatherCode: 0,
      weatherDescription: 'Clear sky',
      windSpeed: 14,
      windDirection: 160,
      humidity: 64,
      isDay: true,
    },
    hourly: buildHourlyForecast(this.daily),
    daily: this.daily,
    lastUpdated: new Date(),
  });

  readonly selectedDay = signal<DailyForecast | null>(null);
  readonly showDetailModal = signal(false);

  readonly selectedDayHourly = computed<HourlyForecast[]>(() => {
    const day = this.selectedDay();
    if (!day) {
      return [];
    }
    return this.weatherData().hourly.filter(hour => hour.time.startsWith(day.date));
  });

  openDetailModal(day: DailyForecast): void {
    this.selectedDay.set(day);
    this.showDetailModal.set(true);
  }

  closeDetailModal(): void {
    this.showDetailModal.set(false);
    this.selectedDay.set(null);
  }

  refreshWeather(): void {
    // No backend to hit — just bumps the "last updated" timestamp for realism.
    this.weatherData.update(data => ({ ...data, lastUpdated: new Date() }));
  }

  getWeatherIcon(code: number, isDay: boolean = true): string {
    if (code === 0) return isDay ? 'sunny-outline' : 'moon-outline';
    if (code === 1 || code === 2) return isDay ? 'partly-sunny-outline' : 'cloudy-night-outline';
    if (code === 3) return 'cloudy-outline';
    if (code === 45 || code === 48) return 'cloudy-outline';
    if (code >= 51 && code <= 57) return 'rainy-outline';
    if (code >= 61 && code <= 67) return 'rainy-outline';
    if (code >= 71 && code <= 77) return 'snow-outline';
    if (code >= 80 && code <= 82) return 'rainy-outline';
    if (code >= 85 && code <= 86) return 'snow-outline';
    if (code >= 95 && code <= 99) return 'thunderstorm-outline';
    return isDay ? 'sunny-outline' : 'moon-outline';
  }

  getWeatherGradient(code: number, isDay: boolean): string {
    if (code === 0) {
      return isDay
        ? 'linear-gradient(135deg, #ffd89b 0%, #19547b 100%)'
        : 'linear-gradient(135deg, #2c3e50 0%, #3498db 100%)';
    }
    if (code >= 1 && code <= 3) {
      return 'linear-gradient(135deg, #e0eafc 0%, #cfdef3 100%)';
    }
    if (code >= 61 && code <= 82) {
      return 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)';
    }
    if (code >= 71 && code <= 86) {
      return 'linear-gradient(135deg, #e6dada 0%, #274046 100%)';
    }
    if (code >= 95) {
      return 'linear-gradient(135deg, #373b44 0%, #4286f4 100%)';
    }
    return 'linear-gradient(135deg, #89f7fe 0%, #66a6ff 100%)';
  }

  getWindDirection(degrees: number): string {
    const directions = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
    const index = Math.round(degrees / 45) % 8;
    return directions[index];
  }

  formatHour(timeString: string): string {
    const date = new Date(timeString);
    return date.toLocaleTimeString('en-US', { hour: 'numeric', hour12: true });
  }

  formatDate(dateString: string): string {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  }

  formatLongDate(dateString: string): string {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  }

  formatUpdated(date: Date): string {
    return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  }

  getDayName(dateString: string): string {
    const date = new Date(dateString);
    const today = new Date();
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    if (date.toDateString() === today.toDateString()) {
      return 'Today';
    }
    if (date.toDateString() === tomorrow.toDateString()) {
      return 'Tomorrow';
    }
    return date.toLocaleDateString('en-US', { weekday: 'short' });
  }

  getUVIndexLabel(uvIndex: number): string {
    if (uvIndex <= 2) return 'Low';
    if (uvIndex <= 5) return 'Moderate';
    if (uvIndex <= 7) return 'High';
    if (uvIndex <= 10) return 'Very High';
    return 'Extreme';
  }

  getUVIndexColor(uvIndex: number): string {
    if (uvIndex <= 2) return '#4ade80';
    if (uvIndex <= 5) return '#fbbf24';
    if (uvIndex <= 7) return '#fb923c';
    if (uvIndex <= 10) return '#ef4444';
    return '#991b1b';
  }
}
