import type { SportKey, WeatherSnapshot } from "./types";

const OUTDOOR_SPORTS: SportKey[] = [
  "americanfootball_nfl",
  "americanfootball_ncaaf",
  "baseball_mlb",
];

export function isOutdoorSport(sport: SportKey): boolean {
  return OUTDOOR_SPORTS.includes(sport);
}

export function hasWeatherUndergroundKey(): boolean {
  return Boolean(process.env.WU_API_KEY?.trim() || process.env.WEATHERUNDERGROUND_API_KEY?.trim());
}

function wuKey(): string | undefined {
  return process.env.WU_API_KEY?.trim() || process.env.WEATHERUNDERGROUND_API_KEY?.trim();
}

async function geocodeCity(
  city: string,
  state?: string,
): Promise<{ lat: number; lon: number; label: string } | null> {
  const query = [city, state].filter(Boolean).join(",");
  const geoUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(
    city,
  )}&count=1&language=en&format=json`;
  const geoRes = await fetch(geoUrl, { next: { revalidate: 86400 } });
  if (!geoRes.ok) return null;
  const geo = await geoRes.json();
  const place = geo?.results?.[0];
  if (!place) return null;
  return {
    lat: Number(place.latitude),
    lon: Number(place.longitude),
    label: [place.name, place.admin1 || state].filter(Boolean).join(", ") || query,
  };
}

/** Weather Underground via The Weather Company (api.weather.com) — requires PWS-owner API key. */
async function fetchWeatherUnderground(opts: {
  lat: number;
  lon: number;
  label: string;
}): Promise<WeatherSnapshot | null> {
  const apiKey = wuKey();
  if (!apiKey) return null;

  const geocode = `${opts.lat},${opts.lon}`;
  const url =
    `https://api.weather.com/v3/wx/observations/current?geocode=${encodeURIComponent(geocode)}` +
    `&units=e&language=en-US&format=json&apiKey=${encodeURIComponent(apiKey)}`;

  const res = await fetch(url, {
    cache: "no-store",
    headers: { Accept: "application/json" },
  });
  if (!res.ok) return null;
  const data = await res.json();

  const tempF = Number(data.temperature ?? data.temp ?? NaN);
  const windMph = Number(data.windSpeed ?? data.wind_speed ?? 0);
  const humidity = Number(data.relativeHumidity ?? data.humidity ?? NaN);
  const feelsLikeF = Number(data.temperatureFeelsLike ?? data.feelsLike ?? NaN);
  const wxPhrase = String(
    data.wxPhraseLong ?? data.wxPhraseMedium ?? data.wxPhraseShort ?? data.cloudCoverPhrase ?? "Unknown",
  );

  // precip: WU current obs may expose precip1Hour / precip24Hour
  const precip1h = Number(data.precip1Hour ?? data.precip24Hour ?? 0);
  const precipChance = Math.min(
    100,
    Math.round(
      (Number.isFinite(precip1h) && precip1h > 0 ? 55 + precip1h * 20 : 0) +
        (/rain|storm|shower|snow|drizzle/i.test(wxPhrase) ? 35 : 0),
    ),
  );

  if (!Number.isFinite(tempF)) return null;

  return {
    location: opts.label,
    tempF: Math.round(tempF),
    windMph: Math.round(Number.isFinite(windMph) ? windMph : 0),
    precipChance,
    condition: wxPhrase,
    outdoorRelevant: true,
    source: "weather-underground",
    humidity: Number.isFinite(humidity) ? Math.round(humidity) : undefined,
    feelsLikeF: Number.isFinite(feelsLikeF) ? Math.round(feelsLikeF) : undefined,
  };
}

async function fetchOpenMeteo(opts: {
  lat: number;
  lon: number;
  label: string;
}): Promise<WeatherSnapshot | null> {
  const weatherUrl =
    `https://api.open-meteo.com/v1/forecast?latitude=${opts.lat}` +
    `&longitude=${opts.lon}&current=temperature_2m,precipitation,weather_code,wind_speed_10m,relative_humidity_2m` +
    `&temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch&timezone=auto`;

  const wRes = await fetch(weatherUrl, { next: { revalidate: 600 } });
  if (!wRes.ok) return null;
  const w = await wRes.json();
  const current = w?.current;
  if (!current) return null;

  const code = Number(current.weather_code ?? 0);
  const precipInch = Number(current.precipitation ?? 0);
  const precipChance = Math.min(100, Math.round(precipInch * 100 + (code >= 51 ? 40 : 0)));

  return {
    location: opts.label,
    tempF: Math.round(Number(current.temperature_2m)),
    windMph: Math.round(Number(current.wind_speed_10m)),
    precipChance,
    condition: weatherCodeToText(code),
    outdoorRelevant: true,
    source: "open-meteo",
    humidity: current.relative_humidity_2m != null
      ? Math.round(Number(current.relative_humidity_2m))
      : undefined,
  };
}

export async function fetchWeatherForVenue(opts: {
  sport: SportKey;
  city?: string;
  state?: string;
  venue?: string;
}): Promise<WeatherSnapshot | null> {
  const outdoorRelevant = isOutdoorSport(opts.sport);
  if (!outdoorRelevant) {
    return {
      location: opts.venue ?? "Indoor arena",
      tempF: 72,
      windMph: 0,
      precipChance: 0,
      condition: "Controlled climate",
      outdoorRelevant: false,
      source: "indoor",
    };
  }

  if (!opts.city) return null;

  try {
    const place = await geocodeCity(opts.city, opts.state);
    if (!place) return null;

    // Prefer Weather Underground when configured
    if (hasWeatherUndergroundKey()) {
      const wu = await fetchWeatherUnderground(place);
      if (wu) return wu;
    }

    const om = await fetchOpenMeteo(place);
    if (om) return om;

    const owKey = process.env.OPENWEATHER_API_KEY?.trim();
    if (owKey) {
      const query = [opts.city, opts.state].filter(Boolean).join(",");
      const url =
        `https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(query)}` +
        `&units=imperial&appid=${owKey}`;
      const res = await fetch(url, { next: { revalidate: 600 } });
      if (!res.ok) return null;
      const data = await res.json();
      return {
        location: `${data.name}${data.sys?.country ? `, ${data.sys.country}` : ""}`,
        tempF: Math.round(Number(data.main?.temp ?? 0)),
        windMph: Math.round(Number(data.wind?.speed ?? 0)),
        precipChance: data.rain ? 70 : data.snow ? 60 : 10,
        condition: String(data.weather?.[0]?.description ?? "Unknown"),
        outdoorRelevant: true,
        source: "openweather",
        humidity: data.main?.humidity != null ? Number(data.main.humidity) : undefined,
        feelsLikeF: data.main?.feels_like != null ? Math.round(Number(data.main.feels_like)) : undefined,
      };
    }

    return null;
  } catch {
    return null;
  }
}

function weatherCodeToText(code: number): string {
  if (code === 0) return "Clear";
  if (code <= 3) return "Partly cloudy";
  if (code <= 48) return "Foggy";
  if (code <= 57) return "Drizzle";
  if (code <= 67) return "Rain";
  if (code <= 77) return "Snow";
  if (code <= 82) return "Showers";
  if (code <= 86) return "Snow showers";
  if (code <= 99) return "Thunderstorm";
  return "Variable";
}

/** Adjust totals / run game pace based on weather. Returns additive probability shifts. */
export function weatherAdjustments(weather: WeatherSnapshot | null | undefined): {
  totalUnderBoost: number;
  windNote?: string;
} {
  if (!weather?.outdoorRelevant) return { totalUnderBoost: 0 };

  let boost = 0;
  const notes: string[] = [];

  if (weather.windMph >= 15) {
    boost += 0.03;
    notes.push(`Wind ${weather.windMph} mph favors unders`);
  }
  if (weather.precipChance >= 40) {
    boost += 0.025;
    notes.push(`${weather.precipChance}% precip chance`);
  }
  if (weather.tempF <= 35) {
    boost += 0.02;
    notes.push(`Cold ${weather.tempF}°F`);
  }
  if (weather.source === "weather-underground") {
    notes.push("Weather Underground");
  }

  return { totalUnderBoost: boost, windNote: notes.join(" · ") || undefined };
}
