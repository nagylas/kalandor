import * as FileSystem from "expo-file-system/legacy";
import { useFocusEffect, useRouter } from "expo-router";
import * as Sharing from "expo-sharing";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  ImageBackground,
  Platform,
  Pressable,
  StyleSheet,
  TextInput,
  useWindowDimensions,
  View
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

/* eslint-disable react-hooks/set-state-in-effect, react-hooks/preserve-manual-memoization, react-hooks/purity */

const DateTimePicker =
  Platform.OS !== "web"
    ? require("@react-native-community/datetimepicker").default
    : null;

import { collection, getDocs } from "firebase/firestore";

import { db } from "@/../firebase";
import DaySegmentList from "@/components/DaySegmentList";
import DayTimeTable from "@/components/DayTimeTable";
import { PlannerPage } from "@/components/plannerpage";
import {
  getAvailableSegments,
  getTripSegments,
  readTripsFromFile,
  sortSegmentsByTime,
  sortTripsByStartDate,
  type Trip,
  writeTripsToFile,
} from "@/components/plannerStorage";
import { Segment } from "@/components/plannerTypes";
import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { BottomTabInset, MaxContentWidth, Spacing } from "@/constants/theme";
import { DEFAULT_LOCALE, t } from "@/i18n";

type TripFormState = {
  name: string;
  startDate: string;
  endDate: string;
};

const TRAVEL_BACKGROUND_IMAGE =
  "https://images.unsplash.com/photo-1469474968028-56623f02e42e?auto=format&fit=crop&w=1920&q=80";

function isValidDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const parsed = new Date(`${value}T00:00:00`);
  return parsed instanceof Date && !Number.isNaN(parsed.getTime());
}

function formatDate(value: string) {
  if (!value) return "TBD";

  const parsed = new Date(`${value}T00:00:00`);
  return parsed.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function toDateInputValue(value: string) {
  if (!value) {
    return new Date();
  }

  const parsed = new Date(`${value}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

function toDateString(value: Date) {
  const year = value.getFullYear();
  const month = `${value.getMonth() + 1}`.padStart(2, "0");
  const day = `${value.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function enumerateDays(start: string, end: string) {
  if (!isValidDate(start) || !isValidDate(end) || end < start) {
    return [] as string[];
  }

  const days: string[] = [];
  let current = new Date(`${start}T00:00:00`);
  const last = new Date(`${end}T00:00:00`);

  while (current <= last) {
    days.push(toDateString(current));
    current = new Date(
      current.getFullYear(),
      current.getMonth(),
      current.getDate() + 1,
    );
  }

  return days;
}

function formatHourLabel(hour: number) {
  const suffix = hour < 12 ? "AM" : "PM";
  const value = hour % 12 === 0 ? 12 : hour % 12;
  return `${value}:00 ${suffix}`;
}

const CORE_HOURS = Array.from({ length: 13 }, (_, index) => index + 8);
const EXTRA_HOURS = [
  ...Array.from({ length: 8 }, (_, index) => index),
  ...Array.from({ length: 3 }, (_, index) => index + 21),
];
const HOURS = [...CORE_HOURS, ...EXTRA_HOURS];
const TIMELINE_ROW_HEIGHT = 34;

function timeToMinutes(value: string) {
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

function minutesToTime(totalMinutes: number) {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function formatHumanDurationMinutes(totalMinutes: number) {
  const safeMinutes = Math.max(0, Math.round(totalMinutes));
  const hours = Math.floor(safeMinutes / 60);
  const minutes = safeMinutes % 60;

  if (hours > 0) {
    return `${hours} óra, ${minutes} perc`;
  }

  return `${safeMinutes} perc`;
}

type TripExportWeather = {
  temperatureC: number | null;
  precipitationMm: number | null;
  sky: string;
};

type TripExportDay = {
  day: string;
  segments: Segment[];
  weatherBySegmentId: Record<string, TripExportWeather>;
};

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function extractImageUrlsFromDetails(details: string) {
  const urls = new Set<string>();

  const markdownUrls = [
    ...details.matchAll(/!\[[^\]]*\]\((https?:\/\/[^)]+)\)/gi),
  ].map((match) => match[1]);

  for (const url of markdownUrls) {
    urls.add(url);
  }

  const directUrls = [
    ...details.matchAll(
      /https?:\/\/[^\s<>"')]+\.(?:png|jpe?g|gif|webp|svg|avif|bmp)(?:\?[^\s<>"')]*)?/gi,
    ),
  ].map((match) => match[0]);

  for (const url of directUrls) {
    urls.add(url);
  }

  return [...urls].slice(0, 2);
}

function formatExportDate(value: string) {
  if (!value) return "TBD";

  const parsed = new Date(`${value}T00:00:00`);
  return Number.isNaN(parsed.getTime())
    ? value
    : parsed.toLocaleDateString(undefined, {
        weekday: "short",
        month: "short",
        day: "numeric",
        year: "numeric",
      });
}

function formatRouteSummaryMinutes(totalMinutes: number) {
  const safeMinutes = Math.max(0, Math.round(totalMinutes));
  const hours = Math.floor(safeMinutes / 60);
  const minutes = safeMinutes % 60;

  if (hours === 0) {
    return `${minutes} perc`;
  }

  if (minutes === 0) {
    return `${hours} óra`;
  }

  return `${hours} óra ${minutes} perc`;
}

function calculateTripSummary(exportDays: TripExportDay[]) {
  return exportDays.reduce(
    (summary, dayEntry) => {
      dayEntry.segments.forEach((segment) => {
        if (segment.locationMode !== "route") {
          return;
        }

        const hasRouteStops =
          Array.isArray(segment.routeStops) && segment.routeStops.length > 0;
        const candidateStopCount = hasRouteStops
          ? segment.routeStops!.length
          : segment.startLocation || segment.endLocation
            ? 2
            : 0;

        summary.stops += candidateStopCount;

        if (segment.commuteType === "car" || segment.commuteType === "ferry") {
          summary.driveKm += Number(segment.routeDistanceKm) || 0;
          summary.driveMinutes += Number(segment.routeTravelMinutes) || 0;
        }

        if (segment.commuteType === "walking") {
          summary.walkKm += Number(segment.routeDistanceKm) || 0;
          summary.walkMinutes += Number(segment.routeTravelMinutes) || 0;
        }
      });

      return summary;
    },
    {
      stops: 0,
      driveKm: 0,
      driveMinutes: 0,
      walkKm: 0,
      walkMinutes: 0,
    },
  );
}

function calculateDayCommuteSummary(dayEntry: TripExportDay) {
  const totals = {
    car: { distanceKm: 0, minutes: 0 },
    walking: { distanceKm: 0, minutes: 0 },
    plane: { distanceKm: 0, minutes: 0 },
    ferry: { distanceKm: 0, minutes: 0 },
  };

  dayEntry.segments.forEach((segment) => {
    if (segment.locationMode !== "route" || !segment.commuteType) {
      return;
    }

    const type = segment.commuteType;
    if (!(type in totals)) {
      return;
    }

    totals[type].distanceKm += Number(segment.routeDistanceKm) || 0;
    totals[type].minutes += Number(segment.routeTravelMinutes) || 0;
  });

  return (Object.keys(totals) as Array<keyof typeof totals>)
    .map((type) => ({
      type,
      label:
        type === "car"
          ? "Autó"
          : type === "walking"
            ? "Gyalog"
            : type === "plane"
              ? "Repülő"
              : "Komp",
      ...totals[type],
    }))
    .filter((entry) => entry.distanceKm > 0 || entry.minutes > 0);
}

function getExportSegmentLocationText(segment: Segment) {
  if (segment.locationMode === "route") {
    const start = segment.startLocation?.trim();
    const end = segment.endLocation?.trim();
    if (start && end) {
      return `${start} → ${end}`;
    }
    return start || end || "Route";
  }

  return segment.location?.trim() || "Location";
}

function getExportSegmentCoordinates(
  segment: Segment,
): { latitude: number; longitude: number } | null {
  if (segment.locationMode === "single") {
    const latitude = segment.locationLat;
    const longitude = segment.locationLon;
    if (
      typeof latitude === "number" &&
      Number.isFinite(latitude) &&
      typeof longitude === "number" &&
      Number.isFinite(longitude)
    ) {
      return { latitude, longitude };
    }
  }

  if (segment.locationMode === "route") {
    const latitude = segment.startLocationLat;
    const longitude = segment.startLocationLon;
    if (
      typeof latitude === "number" &&
      Number.isFinite(latitude) &&
      typeof longitude === "number" &&
      Number.isFinite(longitude)
    ) {
      return { latitude, longitude };
    }
  }

  return null;
}

async function fetchTripExportWeather(
  segment: Segment,
  day: string,
): Promise<TripExportWeather> {
  if (segment.locationMode !== "single") {
    return {
      temperatureC: null,
      precipitationMm: null,
      sky: "Route segment",
    };
  }

  const coordinates = getExportSegmentCoordinates(segment);
  if (!coordinates) {
    return {
      temperatureC: null,
      precipitationMm: null,
      sky: "No weather data",
    };
  }

  try {
    const response = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${coordinates.latitude}&longitude=${coordinates.longitude}&hourly=temperature_2m,precipitation,weather_code&timezone=auto&start_date=${day}&end_date=${day}`,
    );

    if (!response.ok) {
      return {
        temperatureC: null,
        precipitationMm: null,
        sky: "Unavailable",
      };
    }

    const payload = (await response.json()) as {
      hourly?: {
        time?: string[];
        temperature_2m?: number[];
        precipitation?: number[];
        weather_code?: number[];
      };
    };

    const times = payload.hourly?.time ?? [];
    const temperatures = payload.hourly?.temperature_2m ?? [];
    const precipitationValues = payload.hourly?.precipitation ?? [];
    const weatherCodes = payload.hourly?.weather_code ?? [];

    if (times.length === 0 || temperatures.length === 0) {
      return {
        temperatureC: null,
        precipitationMm: null,
        sky: "Unavailable",
      };
    }

    const hourIndex = Math.min(
      Math.max(Math.floor(timeToMinutes(segment.startTime) / 60), 0),
      Math.max(times.length - 1, 0),
    );

    const temperature = temperatures[hourIndex] ?? null;
    const precipitation = precipitationValues[hourIndex] ?? null;
    const weatherCode = weatherCodes[hourIndex];
    const weatherLabel =
      typeof weatherCode === "number"
        ? ({
            0: "Clear",
            1: "Mostly clear",
            2: "Partly cloudy",
            3: "Cloudy",
            45: "Foggy",
            48: "Foggy",
            51: "Light drizzle",
            53: "Drizzle",
            55: "Heavy drizzle",
            56: "Freezing drizzle",
            57: "Heavy freezing drizzle",
            61: "Light rain",
            63: "Rain",
            65: "Heavy rain",
            66: "Freezing rain",
            67: "Heavy freezing rain",
            71: "Light snow",
            73: "Snow",
            75: "Heavy snow",
            77: "Snow grains",
            80: "Rain showers",
            81: "Heavy showers",
            82: "Heavy rain showers",
            85: "Snow showers",
            86: "Heavy snow showers",
            95: "Thunderstorm",
            96: "Thunderstorm with hail",
            99: "Severe thunderstorm",
          }[weatherCode] ?? "Conditions")
        : "Conditions";

    return {
      temperatureC:
        typeof temperature === "number" && Number.isFinite(temperature)
          ? temperature
          : null,
      precipitationMm:
        typeof precipitation === "number" && Number.isFinite(precipitation)
          ? precipitation
          : null,
      sky: weatherLabel,
    };
  } catch {
    return {
      temperatureC: null,
      precipitationMm: null,
      sky: "Unavailable",
    };
  }
}

function simplifyExportLocation(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "Location";

  const parts = trimmed
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);

  if (parts.length <= 2) {
    return parts.join(", ");
  }

  return parts.slice(0, 2).join(", ");
}

function getCommuteTypeIcon(commuteType?: Segment["commuteType"]) {
  if (commuteType === "walking") {
    return "🚶";
  }

  if (commuteType === "plane") {
    return "✈️";
  }

  if (commuteType === "ferry") {
    return "⛴️";
  }

  return "🚗";
}

function getWeatherIcon(sky?: string) {
  const normalized = (sky ?? "").toLowerCase();

  if (normalized.includes("sun") || normalized.includes("clear")) {
    return "☀️";
  }

  if (normalized.includes("cloud") || normalized.includes("overcast")) {
    return "☁️";
  }

  if (normalized.includes("rain") || normalized.includes("showers")) {
    return "🌧️";
  }

  if (normalized.includes("snow") || normalized.includes("storm")) {
    return "❄️";
  }

  return "🌤️";
}

function getCompactCommuteTypeLabel(commuteType?: Segment["commuteType"]) {
  if (commuteType === "walking") {
    return "gyalog";
  }

  if (commuteType === "plane") {
    return "repülő";
  }

  if (commuteType === "ferry") {
    return "komp";
  }

  return "autó";
}

function buildTripExportHtml(
  trip: Trip,
  exportDays: TripExportDay[],
  initialDay?: string,
) {
  const activeDay =
    initialDay && exportDays.some((day) => day.day === initialDay)
      ? initialDay
      : (exportDays[0]?.day ?? trip.startDate);
  const tripMapPoints: Array<{ lat: number; lon: number; label: string }> = [];

  const buildDaySection = (dayEntry: TripExportDay) => {
    const orderedSegments = [...dayEntry.segments].sort(
      (left, right) =>
        timeToMinutes(left.startTime) - timeToMinutes(right.startTime),
    );

    const timelineRows: Array<{
      type: "program-start" | "segment" | "buffer" | "program-end";
      start: string;
      end: string;
      label: string;
      note?: string;
      segment?: Segment;
    }> = [];

    if (orderedSegments.length > 0) {
      const firstSegment = orderedSegments[0];
      timelineRows.push({
        type: "program-start",
        start: firstSegment.startTime,
        end: firstSegment.startTime,
        label: t("trip.programStarts", DEFAULT_LOCALE, "Program starts"),
        note: firstSegment.activityDescription,
      });
    }

    orderedSegments.forEach((segment, index) => {
      timelineRows.push({
        type: "segment",
        start: segment.startTime,
        end: segment.endTime,
        label: segment.activityDescription,
        note: segment.locationMode === "route" ? "Route" : "Location",
        segment,
      });

      const nextSegment = orderedSegments[index + 1];
      if (!nextSegment) {
        return;
      }

      const gapStartMinutes = timeToMinutes(segment.endTime);
      const gapEndMinutes = timeToMinutes(nextSegment.startTime);
      if (gapEndMinutes > gapStartMinutes) {
        timelineRows.push({
          type: "buffer",
          start: segment.endTime,
          end: nextSegment.startTime,
          label: t("trip.bufferTime", DEFAULT_LOCALE, "BUFFER TIME"),
          note: `Open buffer between ${segment.activityDescription} and ${nextSegment.activityDescription}`,
        });
      }
    });

    if (orderedSegments.length > 0) {
      const lastSegment = orderedSegments[orderedSegments.length - 1];
      timelineRows.push({
        type: "program-end",
        start: lastSegment.endTime,
        end: lastSegment.endTime,
        label: t("trip.programEnds", DEFAULT_LOCALE, "Program ends"),
        note: lastSegment.activityDescription,
      });
    }

    const renderRow = (row: (typeof timelineRows)[number]) => {
      const cardTitle = row.label;

      if (row.type === "buffer") {
        return `
          <article class="segment-card">
            <div class="time-card buffer-card">
              <div class="time-badge">${escapeHtml(row.start)}</div>
              <div class="time-divider">–</div>
              <div class="time-badge">${escapeHtml(row.end)}</div>
            </div>
            <div class="segment-stack">
              <div class="info-card buffer-card-inner">
                <div class="card-title">${escapeHtml(cardTitle)}</div>
              </div>
            </div>
          </article>
        `;
      }

      if (row.type === "program-start") {
        return `
          <article class="segment-card">
            <div class="time-card program-card">
              <div class="time-badge">${escapeHtml(row.start)}</div>
            </div>
            <div class="segment-stack">
              <div class="info-card program-card-inner">
                <div class="card-title">${escapeHtml(cardTitle)}</div>
              </div>
            </div>
          </article>
        `;
      }

      if (row.type === "program-end") {
        return `
          <article class="segment-card">
            <div class="time-card program-end-card">
              <div class="time-badge">${escapeHtml(row.start)}</div>
            </div>
            <div class="segment-stack">
              <div class="info-card program-end-card-inner">
                <div class="card-title">${escapeHtml(cardTitle)}</div>
              </div>
            </div>
          </article>
        `;
      }

      const segment = row.segment;
      if (!segment) {
        return "";
      }

      const durationMinutes = Math.max(
        0,
        timeToMinutes(segment.endTime) - timeToMinutes(segment.startTime),
      );
      const weather =
        segment.locationMode === "single"
          ? (dayEntry.weatherBySegmentId[segment.id] ?? {
              temperatureC: null,
              precipitationMm: null,
              sky: "Unavailable",
            })
          : null;

      const locations =
        segment.locationMode === "route"
          ? segment.routeStops && segment.routeStops.length > 0
            ? segment.routeStops.map((stop) => stop.display_name)
            : ([segment.startLocation, segment.endLocation].filter(
                Boolean,
              ) as string[])
          : ([segment.location].filter(Boolean) as string[]);

      const routeRows =
        segment.locationMode === "route"
          ? [
              [
                t("trip.duration", DEFAULT_LOCALE, "Duration"),
                formatHumanDurationMinutes(durationMinutes),
              ],
              [
                t("trip.commute", DEFAULT_LOCALE, "Commute"),
                segment.commuteType
                  ? segment.commuteType === "walking"
                    ? "Gyalog"
                    : segment.commuteType === "plane"
                      ? "Repülő"
                      : segment.commuteType === "ferry"
                        ? "Komp"
                        : "Autó"
                  : "—",
              ],
              [
                t("trip.distance", DEFAULT_LOCALE, "Distance"),
                segment.routeDistanceKm != null
                  ? `${segment.routeDistanceKm.toFixed(1)} km`
                  : "—",
              ],
              [
                t("trip.travelTime", DEFAULT_LOCALE, "Travel time"),
                segment.routeTravelMinutes != null
                  ? formatHumanDurationMinutes(segment.routeTravelMinutes)
                  : "—",
              ],
            ].filter(([, value]) => value !== "—")
          : [
              [
                t("trip.duration", DEFAULT_LOCALE, "Duration"),
                formatHumanDurationMinutes(durationMinutes),
              ],
              [
                t("trip.weather.sky", DEFAULT_LOCALE, "Sky"),
                weather?.sky ?? "—",
              ],
              [
                t("trip.weather.temperature", DEFAULT_LOCALE, "Temperature"),
                weather?.temperatureC != null
                  ? `${weather.temperatureC.toFixed(1)}°C`
                  : "—",
              ],
              [
                t(
                  "trip.weather.precipitation",
                  DEFAULT_LOCALE,
                  "Precipitation",
                ),
                weather?.precipitationMm != null
                  ? `${weather.precipitationMm.toFixed(1)} mm`
                  : "—",
              ],
            ];

      const routeCard = `
        <div class="info-card">
          <div class="kv-grid">
            ${routeRows
              .map(
                ([label, value]) => `
                  <div class="kv-item">
                    <span>${escapeHtml(String(label))}</span>
                    <strong>${escapeHtml(String(value))}</strong>
                  </div>
                `,
              )
              .join("")}
          </div>
        </div>
      `;

      const renderDetailsHtml = (() => {
        const raw = segment.details ?? "";
        const imageMatches = [
          ...raw.matchAll(/!\[[^\]]*\]\((https?:\/\/[^)]+)\)/gi),
        ].slice(0, 2);

        if (!raw.trim()) {
          return "";
        }

        const textHtml = raw
          .replace(/!\[[^\]]*\]\((https?:\/\/[^)]+)\)/gi, "")
          .replace(/\r\n/g, "\n")
          .replace(/\n{3,}/g, "\n\n")
          .trim();

        const imageHtml = imageMatches.length
          ? imageMatches
              .map(
                (match) =>
                  `<div class="details-image-wrap"><img src="${escapeHtml(match[1])}" alt="Additional detail" loading="lazy" /></div>`,
              )
              .join("")
          : "";

        const renderedTextHtml = textHtml
          ? textHtml
              .split("\n")
              .map((line) => {
                const parenthesizedLinkMatch = line.match(
                  /^(.+?)\s*\((https?:\/\/[^\s)<>]+)\)$/,
                );

                if (parenthesizedLinkMatch) {
                  const label = parenthesizedLinkMatch[1].trim();
                  const linkUrl = parenthesizedLinkMatch[2].replace(
                    /[),.!?]+$/,
                    "",
                  );
                  return `<a href="${escapeHtml(linkUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)}</a>`;
                }

                const labelUrlMatch = line.match(
                  /^(.+?)\s*(?:-|–|—)\s*(https?:\/\/[^\s<>]+)$/,
                );

                if (labelUrlMatch) {
                  const label = labelUrlMatch[1].trim();
                  const linkUrl = labelUrlMatch[2].replace(/[),.!?]+$/, "");
                  return `<a href="${escapeHtml(linkUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)}</a>`;
                }

                return escapeHtml(line)
                  .replace(/^#{1,6}\s*(.+)$/gm, "<strong>$1</strong>")
                  .replace(/\*\*(.+?)\*\*/g, "<em>$1</em>");
              })
              .join("<br />")
          : "";

        const textBlock = renderedTextHtml ? `<p>${renderedTextHtml}</p>` : "";

        return `
          <div class="info-card details-card">
            ${imageHtml}
            ${textBlock}
          </div>
        `;
      })();

      const detailsCard = renderDetailsHtml || "";

      const compactLocationText = (() => {
        if (segment.locationMode === "route") {
          if (segment.routeStops && segment.routeStops.length > 0) {
            const simplifiedStops = segment.routeStops
              .slice(0, 2)
              .map((stop) => simplifyExportLocation(stop.display_name));
            return simplifiedStops.join(" → ");
          }
          const start = segment.startLocation?.trim();
          const end = segment.endLocation?.trim();
          if (start && end) {
            return `${simplifyExportLocation(start)} → ${simplifyExportLocation(end)}`;
          }
          return simplifyExportLocation(start || end || "Route");
        }

        return simplifyExportLocation(segment.location || "Location");
      })();

      const locationList = locations.length
        ? `<div class="compact-location">${escapeHtml(compactLocationText)}</div>`
        : "<div class='empty-inline'>No location</div>";

      return `
        <article class="segment-card">
          <div class="time-card">
            <div class="time-badge">${escapeHtml(segment.startTime)}</div>
            <div class="time-divider">–</div>
            <div class="time-badge">${escapeHtml(segment.endTime)}</div>
          </div>

          <div class="segment-stack">
            <div class="info-card">
              <div class="card-title">${escapeHtml(segment.activityDescription)}</div>
              ${locationList}
            </div>

            ${routeCard}
            ${detailsCard}
          </div>
        </article>
      `;
    };

    const segmentsHtml =
      timelineRows.length > 0
        ? timelineRows.map((row) => renderRow(row)).join("")
        : "<div class='empty-day'>No scheduled segments for this day.</div>";

    const commuteSummary = calculateDayCommuteSummary(dayEntry);
    const commuteSummaryHtml = commuteSummary.length
      ? `
        <div class="commute-summary">
          <div class="commute-summary-title">Összesítés</div>
          <div class="commute-summary-grid">
            ${commuteSummary
              .map(
                (entry) => `
                  <div class="commute-summary-item">
                    <span>${escapeHtml(entry.label)}</span>
                    <strong>${entry.distanceKm.toFixed(1)} km • ${formatHumanDurationMinutes(entry.minutes)}</strong>
                  </div>
                `,
              )
              .join("")}
          </div>
        </div>
      `
      : "";

    return `
      <section class="day-card">
        ${segmentsHtml}
        ${commuteSummaryHtml}
      </section>
    `;
  };

  const dayButtons = exportDays
    .map(
      (dayEntry) => `
        <button
          class="day-tab ${dayEntry.day === activeDay ? "active" : ""}"
          data-target="${escapeHtml(dayEntry.day)}"
          type="button"
        >
          ${escapeHtml(formatExportDate(dayEntry.day))}
        </button>
      `,
    )
    .join("");

  const dayPanelsMarkup = exportDays
    .map(
      (dayEntry) => `
        <section id="day-panel-${escapeHtml(dayEntry.day)}" class="tab-panel ${dayEntry.day === activeDay ? "active" : ""}">
          ${buildDaySection(dayEntry)}
        </section>
      `,
    )
    .join("");

  return `<!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>${escapeHtml(trip.name)} export</title>
        <style>
          :root {
            --page-bg: #ffffff;
            --surface: #f3f4f6;
            --surface-strong: #e5e7eb;
            --text: #111827;
            --muted: #374151;
            --soft: #6b7280;
          }
          * { box-sizing: border-box; }
          body {
            margin: 0;
            background: var(--page-bg);
            color: var(--text);
            font-family: Arial, Helvetica, sans-serif;
            padding: 30px 24px;
          }
          .page {
            position: relative;
            max-width: 1100px;
            width: 210mm;
            min-height: 297mm;
            margin: 0 auto;
            background: #ffffff;
            color: var(--text);
            padding: 12mm 12mm 14mm 12mm;
          }
          .hero,
          .tab-bar,
          .tab-panel,
          .day-card,
          .summary-grid,
          .commute-summary,
          .locations {
            position: relative;
            z-index: 1;
          }
          .hero {
            display: flex;
            align-items: center;
            justify-content: flex-start;
            gap: 18px;
            margin-bottom: 18px;
            padding-bottom: 12px;
          }
          .hero h1 {
            margin: 0;
            font-size: 30px;
            letter-spacing: -0.04em;
            color: var(--text);
          }
          .meta-stack {
            display: none;
          }
          .tab-bar {
            display: flex;
            flex-wrap: wrap;
            gap: 8px;
            margin: 8px 0 18px 0;
          }
          .day-tab {
            appearance: none;
            border: 1px solid #d1d5db;
            background: #f3f4f6;
            color: #111827;
            cursor: pointer;
            font: inherit;
            font-weight: 700;
            padding: 10px 14px;
            border-radius: 999px;
          }
          .day-tab.active {
            background: #111827;
            border-color: #111827;
            color: #ffffff;
          }
          .tab-panel {
            display: none;
          }
          .tab-panel.active {
            display: block;
          }
          .summary-grid {
            display: grid;
            grid-template-columns: repeat(3, minmax(160px, 1fr));
            gap: 14px;
            margin-bottom: 18px;
          }
          .summary-card, .info-card, .time-card, .day-card {
            background: var(--surface);
            border: none;
            border-radius: 0;
            padding: 12px 14px;
          }
          .program-card,
          .program-card-inner {
            background: #dff7d7 !important;
            color: #000000;
          }
          .program-card {
            display: flex;
            align-items: center;
          }
          .program-card-inner {
            display: flex;
            align-items: center;
            min-height: 100%;
          }
          .buffer-card,
          .buffer-card-inner {
            background: #dfeeff !important;
            color: #000000;
          }
          .buffer-card {
            display: flex;
            align-items: center;
          }
          .buffer-card-inner {
            display: flex;
            align-items: center;
            min-height: 100%;
          }
          .program-end-card,
          .program-end-card-inner {
            background: #f9d7d7 !important;
            color: #000000;
          }
          .program-end-card {
            display: flex;
            align-items: center;
          }
          .program-end-card-inner {
            display: flex;
            align-items: center;
            min-height: 100%;
          }
          .program-card-inner,
          .buffer-card-inner,
          .program-end-card-inner {
            border-left: 0;
          }
          .program-card .time-badge,
          .buffer-card .time-badge,
          .program-end-card .time-badge,
          .program-card-inner .card-title,
          .buffer-card-inner .card-title,
          .program-end-card-inner .card-title,
          .program-card .time-divider,
          .buffer-card .time-divider,
          .program-end-card .time-divider {
            color: #000000;
          }
          .program-card-inner .card-title,
          .buffer-card-inner .card-title,
          .program-end-card-inner .card-title {
            margin-bottom: 0;
          }
          .summary-card span {
            display: block;
            color: var(--soft);
            font-size: 10px;
            letter-spacing: 0.08em;
            text-transform: uppercase;
            margin-bottom: 4px;
          }
          .summary-card strong {
            color: var(--text);
            font-size: 16px;
          }
          .commute-summary {
            margin-top: 18px;
            background: #f5f5f5;
            border-top: 1px solid #e5e7eb;
            padding: 16px 14px 12px;
          }
          .commute-summary-title {
            color: var(--soft);
            font-size: 10px;
            letter-spacing: 0.08em;
            text-transform: uppercase;
            font-weight: 700;
            margin-bottom: 10px;
          }
          .commute-summary-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
            gap: 10px;
          }
          .commute-summary-item {
            display: flex;
            flex-direction: column;
            gap: 6px;
            background: #ffffff;
            border: 1px solid #e5e7eb;
            padding: 10px 12px;
          }
          .commute-summary-item span {
            color: var(--soft);
            font-size: 11px;
            letter-spacing: 0.06em;
            text-transform: uppercase;
          }
          .commute-summary-item strong {
            color: var(--text);
            font-size: 14px;
            line-height: 1.4;
          }
          .locations {
            display: none;
          }
          .locations {
            background: #ffffff;
            padding: 0 0 16px 0;
            margin-bottom: 18px;
          }
          .locations h3 {
            margin: 0 0 8px 0;
            font-size: 16px;
            color: var(--text);
          }
          .locations ul {
            margin: 0;
            padding-left: 18px;
            color: var(--text);
            line-height: 1.7;
          }
          .day-card {
            margin-bottom: 18px;
            background: #ffffff;
            padding: 0;
            break-inside: avoid;
          }
          @page {
            size: A4 portrait;
            margin: 8mm 8mm 10mm;
          }
          .day-header h3 {
            margin: 0 0 12px 0;
            font-size: 20px;
            color: var(--text);
          }
          .segment-card {
            display: grid;
            grid-template-columns: 110px minmax(0, 1fr);
            gap: 12px;
            align-items: stretch;
            margin-top: 4px;
            background: #ffffff;
            padding: 0;
          }
          .time-card {
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: flex-start;
            min-height: 100%;
            background: var(--surface);
            padding: 18px 12px;
          }
          .time-badge {
            font-size: 20px;
            font-weight: 700;
            color: var(--text);
            line-height: 1.2;
          }
          .time-divider {
            color: var(--soft);
            font-size: 18px;
            padding: 4px 0;
          }
          .segment-stack {
            display: grid;
            gap: 4px;
          }
          .info-card {
            background: var(--surface);
            padding: 2px 14px;
          }
          .segment-card .info-card:first-child {
            background: #f4e4c9;
            padding: 12px 14px;
          }
          .card-title {
            color: var(--text);
            font-weight: 700;
            font-size: 16px;
            margin-bottom: 8px;
          }
          .compact-location {
            color: var(--text);
            font-size: 12px;
            line-height: 1.4;
            word-break: break-word;
          }
          .kv-grid {
            display: grid;
            grid-template-columns: repeat(2, minmax(150px, 1fr));
            gap: 5px 8px;
          }
          .kv-item {
            display: flex;
            flex-direction: column;
            gap: 2px;
          }
          .kv-item span {
            color: var(--soft);
            font-size: 10px;
            letter-spacing: 0.08em;
            text-transform: uppercase;
          }
          .kv-item strong {
            font-size: 13px;
            color: var(--text);
          }
          .details-card p {
            margin: 0;
            color: var(--text);
            line-height: 1.4;
          }
          .details-image-wrap {
            margin: 0 0 8px 0;
            border-radius: 8px;
            overflow: hidden;
            background: #f3f4f6;
          }
          .details-image-wrap img {
            display: block;
            width: 100%;
            max-height: 280px;
            object-fit: contain;
            background: #ffffff;
          }
          .empty-day, .empty-inline {
            color: var(--soft);
            font-style: italic;
            background: var(--surface);
            padding: 12px 14px;
          }
          @media print {
            body {
              background: #ffffff;
              padding: 0;
            }
            .page {
              width: 210mm;
              min-height: 297mm;
              max-width: none;
              margin: 0;
              background: #ffffff;
              color: var(--text);
              box-shadow: none;
            }
          }
        </style>
      </head>
      <body>
        <div class="page">
          <div class="hero">
            <h1>${escapeHtml(trip.name)}</h1>
          </div>

          <div class="tab-bar">
            ${dayButtons}
          </div>

          ${dayPanelsMarkup}
        </div>
      </body>
    </html>`;
}

function buildMobileShareTripExportHtml(
  trip: Trip,
  exportDays: TripExportDay[],
  initialDay?: string,
) {
  const activeDay =
    initialDay && exportDays.some((day) => day.day === initialDay)
      ? initialDay
      : (exportDays[0]?.day ?? trip.startDate);

  const buildDaySection = (dayEntry: TripExportDay) => {
    const orderedSegments = [...dayEntry.segments].sort(
      (left, right) =>
        timeToMinutes(left.startTime) - timeToMinutes(right.startTime),
    );

    const rows = orderedSegments.map((segment) => {
      const durationMinutes = Math.max(
        0,
        timeToMinutes(segment.endTime) - timeToMinutes(segment.startTime),
      );

      const weather =
        segment.locationMode === "single"
          ? (dayEntry.weatherBySegmentId[segment.id] ?? {
              temperatureC: null,
              precipitationMm: null,
              sky: "Unavailable",
            })
          : null;

      const detailsText = (segment.details ?? "")
        .replace(/!\[[^\]]*\]\((https?:\/\/[^)]+)\)/gi, "")
        .replace(/\r\n/g, "\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim();

      const imageHtml = "";

      const infoPills = [
        segment.locationMode === "route"
          ? segment.routeDistanceKm != null
            ? `<span class="mini-pill"><span class="mini-icon">${getCommuteTypeIcon(segment.commuteType)}</span><span>${segment.routeDistanceKm.toFixed(1)} km</span></span>`
            : ""
          : weather?.temperatureC != null
            ? `<span class="mini-pill"><span class="mini-icon">${getWeatherIcon(weather.sky)}</span><span>${weather.temperatureC.toFixed(1)}°C</span></span>`
            : "",
        segment.locationMode === "route"
          ? segment.routeTravelMinutes != null
            ? `<span class="mini-pill"><span class="mini-icon">⏱️</span><span>${formatHumanDurationMinutes(segment.routeTravelMinutes)}</span></span>`
            : ""
          : weather?.precipitationMm != null
            ? `<span class="mini-pill"><span class="mini-icon">🌧️</span><span>${weather.precipitationMm.toFixed(1)} mm</span></span>`
            : "",
      ].filter(Boolean);

      const detailHtml = detailsText
        ? detailsText
            .split("\n")
            .map((line) => {
              const parenthesizedLinkMatch = line.match(
                /^(.+?)\s*\((https?:\/\/[^\s)<>]+)\)$/,
              );
              if (parenthesizedLinkMatch) {
                const label = parenthesizedLinkMatch[1].trim();
                const linkUrl = parenthesizedLinkMatch[2].replace(
                  /[),.!?]+$/,
                  "",
                );
                return `<a href="${escapeHtml(linkUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)}</a>`;
              }

              const labelUrlMatch = line.match(
                /^(.+?)\s*(?:-|–|—)\s*(https?:\/\/[^\s<>]+)$/,
              );
              if (labelUrlMatch) {
                const label = labelUrlMatch[1].trim();
                const linkUrl = labelUrlMatch[2].replace(/[),.!?]+$/, "");
                return `<a href="${escapeHtml(linkUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)}</a>`;
              }

              return escapeHtml(line)
                .replace(/^#{1,6}\s*(.+)$/gm, "<strong>$1</strong>")
                .replace(/\*\*(.+?)\*\*/g, "<em>$1</em>");
            })
            .join("<br />")
        : "";

      return `
        <article class="segment-row">
          <div class="segment-time">
            <strong>${escapeHtml(segment.startTime)}</strong>
            <span>${escapeHtml(formatHumanDurationMinutes(durationMinutes))}</span>
            <strong>${escapeHtml(segment.endTime)}</strong>
          </div>
          <div class="segment-card">
            <div class="segment-title">${escapeHtml(segment.activityDescription)}</div>
            <div class="segment-meta-row">${infoPills.join("") || '<span class="mini-pill muted">No extra details</span>'}</div>
            ${imageHtml}
            ${detailHtml ? `<div class="segment-detail">${detailHtml}</div>` : ""}
          </div>
        </article>
      `;
    });

    return `
      <section class="day-block">
        <div class="day-header">${escapeHtml(formatExportDate(dayEntry.day))}</div>
        ${rows.join("") || "<div class='empty'>No items</div>"}
      </section>
    `;
  };

  const dayPanels = exportDays
    .map(
      (dayEntry) => `
        <section class="day-panel ${dayEntry.day === activeDay ? "active" : ""}">
          ${buildDaySection(dayEntry)}
        </section>
      `,
    )
    .join("");

  return `<!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
        <title>${escapeHtml(trip.name)} mobile share</title>
        <style>
          :root {
            --bg: #f8fafc;
            --panel: #ffffff;
            --soft: #eef2ff;
            --text: #111827;
            --muted: #475569;
            --line: #e2e8f0;
            --accent: #2563eb;
          }
          * { box-sizing: border-box; }
          body {
            margin: 0;
            background: var(--bg);
            color: var(--text);
            font-family: Arial, Helvetica, sans-serif;
            padding: 8px;
          }
          .page {
            max-width: 100%;
            width: 100%;
            margin: 0 auto;
            background: var(--bg);
            padding: 0;
          }
          .title {
            margin: 0 0 10px;
            font-size: 22px;
            font-weight: 700;
            line-height: 1.2;
            letter-spacing: -0.04em;
          }
          .day-block {
            margin: 0 0 10px 0;
            border: 1px solid var(--line);
            background: var(--panel);
            border-radius: 10px;
            overflow: hidden;
          }
          .day-header {
            background: var(--soft);
            color: var(--text);
            padding: 8px 10px;
            font-weight: 700;
            font-size: 13px;
            border-bottom: 1px solid var(--line);
          }
          .segment-row {
            display: grid;
            grid-template-columns: 76px 1fr;
            gap: 8px;
            padding: 8px;
            border-bottom: 1px solid var(--line);
          }
          .segment-row:last-child {
            border-bottom: none;
          }
          .segment-time {
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: flex-start;
            text-align: center;
            background: #f8fafc;
            border: 1px solid var(--line);
            border-radius: 8px;
            padding: 6px 4px;
            font-size: 11px;
            color: var(--muted);
            line-height: 1.3;
          }
          .segment-time strong {
            font-size: 12px;
            color: var(--text);
            line-height: 1.3;
          }
          .segment-card {
            background: #fff;
            border: 1px solid var(--line);
            border-radius: 8px;
            padding: 8px;
          }
          .segment-title {
            font-size: 14px;
            font-weight: 700;
            margin-bottom: 4px;
            line-height: 1.25;
          }
          .segment-meta-row {
            display: flex;
            flex-wrap: wrap;
            gap: 5px;
            margin: 0 0 5px;
          }
          .mini-pill {
            display: inline-flex;
            align-items: center;
            gap: 4px;
            padding: 3px 6px;
            border-radius: 999px;
            background: #eff6ff;
            border: 1px solid #dbeafe;
            color: var(--text);
            font-size: 10px;
            font-weight: 700;
            line-height: 1.2;
          }
          .mini-pill.muted {
            background: #f8fafc;
            border-color: var(--line);
            color: var(--muted);
          }
          .mini-icon {
            font-size: 11px;
            line-height: 1;
          }
          .segment-detail {
            color: var(--text);
            font-size: 11px;
            line-height: 1.45;
            white-space: normal;
            word-break: break-word;
          }
          .segment-detail a {
            color: var(--accent);
            overflow-wrap: anywhere;
          }
          .empty {
            padding: 12px 10px;
            color: var(--muted);
            font-size: 12px;
          }
          @media (max-width: 420px) {
            body {
              padding: 6px;
            }
            .segment-row {
              grid-template-columns: 68px 1fr;
              gap: 6px;
              padding: 6px;
            }
          }
        </style>
      </head>
      <body>
        <div class="page">
          <h1 class="title">${escapeHtml(trip.name)}</h1>
          ${dayPanels}
        </div>
      </body>
    </html>`;
}

function buildDailyScheduleTripExportHtml(
  trip: Trip,
  exportDays: TripExportDay[],
) {
  const buildDaySection = (dayEntry: TripExportDay) => {
    const orderedSegments = [...dayEntry.segments].sort(
      (left, right) =>
        timeToMinutes(left.startTime) - timeToMinutes(right.startTime),
    );

    const rows = orderedSegments.map((segment) => {
      const durationMinutes = Math.max(
        0,
        timeToMinutes(segment.endTime) - timeToMinutes(segment.startTime),
      );

      const weather =
        segment.locationMode === "single"
          ? (dayEntry.weatherBySegmentId[segment.id] ?? {
              temperatureC: null,
              precipitationMm: null,
              sky: "Unavailable",
            })
          : null;

      const infoPills = [
        segment.locationMode === "route"
          ? segment.routeDistanceKm != null
            ? `<span class="mini-pill"><span class="mini-icon">${getCommuteTypeIcon(segment.commuteType)}</span><span>${segment.routeDistanceKm.toFixed(1)} km</span></span>`
            : ""
          : weather?.temperatureC != null
            ? `<span class="mini-pill"><span class="mini-icon">${getWeatherIcon(weather.sky)}</span><span>${weather.temperatureC.toFixed(1)}°C</span></span>`
            : "",
        segment.locationMode === "route"
          ? segment.routeTravelMinutes != null
            ? `<span class="mini-pill"><span class="mini-icon">⏱️</span><span>${formatHumanDurationMinutes(segment.routeTravelMinutes)}</span></span>`
            : ""
          : weather?.precipitationMm != null
            ? `<span class="mini-pill"><span class="mini-icon">🌧️</span><span>${weather.precipitationMm.toFixed(1)} mm</span></span>`
            : "",
      ].filter(Boolean);

      return `
        <article class="segment-row">
          <div class="segment-time">
            <strong>${escapeHtml(segment.startTime)}</strong>
            <span>${escapeHtml(formatHumanDurationMinutes(durationMinutes))}</span>
            <strong>${escapeHtml(segment.endTime)}</strong>
          </div>
          <div class="segment-card">
            <div class="segment-title">${escapeHtml(segment.activityDescription)}</div>
            ${infoPills.length ? `<div class="segment-meta-row">${infoPills.join("")}</div>` : ""}
          </div>
        </article>
      `;
    });

    return `
      <section class="day-page">
        <div class="day-header">${escapeHtml(formatExportDate(dayEntry.day))}</div>
        ${rows.join("") || "<div class='empty'>No items</div>"}
      </section>
    `;
  };

  const dayPages = exportDays
    .map((dayEntry) => buildDaySection(dayEntry))
    .join("");

  return `<!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
        <title>${escapeHtml(trip.name)} day schedule</title>
        <style>
          :root {
            --bg: #f8fafc;
            --panel: #ffffff;
            --soft: #eef2ff;
            --text: #111827;
            --muted: #475569;
            --line: #e2e8f0;
            --accent: #2563eb;
          }
          * { box-sizing: border-box; }
          body {
            margin: 0;
            background: var(--bg);
            color: var(--text);
            font-family: Arial, Helvetica, sans-serif;
            padding: 12px;
          }
          .page {
            max-width: 900px;
            width: 100%;
            margin: 0 auto;
            background: var(--bg);
            padding: 0;
          }
          .title {
            margin: 0 0 14px;
            font-size: 26px;
            font-weight: 700;
            line-height: 1.2;
            letter-spacing: -0.04em;
          }
          .day-page {
            margin: 0 0 18px 0;
            border: 1px solid var(--line);
            background: var(--panel);
            border-radius: 12px;
            overflow: hidden;
            page-break-before: always;
            break-before: page;
          }
          .day-page:first-child {
            page-break-before: auto;
            break-before: auto;
          }
          .day-header {
            background: var(--soft);
            color: var(--text);
            padding: 10px 12px;
            font-weight: 700;
            font-size: 15px;
            border-bottom: 1px solid var(--line);
          }
          .segment-row {
            display: grid;
            grid-template-columns: 92px 1fr;
            gap: 10px;
            padding: 10px;
            border-bottom: 1px solid var(--line);
          }
          .segment-row:last-child {
            border-bottom: none;
          }
          .segment-time {
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            text-align: center;
            background: #f8fafc;
            border: 1px solid var(--line);
            border-radius: 10px;
            padding: 8px 6px;
            font-size: 11px;
            color: var(--muted);
            line-height: 1.35;
          }
          .segment-time strong {
            font-size: 13px;
            color: var(--text);
            line-height: 1.3;
          }
          .segment-card {
            background: #fff;
            border: 1px solid var(--line);
            border-radius: 10px;
            padding: 10px 12px;
            display: flex;
            flex-direction: column;
            justify-content: center;
          }
          .segment-title {
            font-size: 15px;
            font-weight: 700;
            line-height: 1.3;
            margin-bottom: 6px;
          }
          .segment-meta-row {
            display: flex;
            flex-wrap: wrap;
            gap: 6px;
          }
          .mini-pill {
            display: inline-flex;
            align-items: center;
            gap: 5px;
            padding: 4px 8px;
            border-radius: 999px;
            background: #eff6ff;
            border: 1px solid #dbeafe;
            color: var(--text);
            font-size: 10px;
            font-weight: 700;
            line-height: 1.2;
          }
          .mini-icon {
            font-size: 11px;
            line-height: 1;
          }
          .empty {
            padding: 14px 12px;
            color: var(--muted);
            font-size: 12px;
          }
          @media print {
            body {
              background: #ffffff;
              padding: 0;
            }
            .page {
              max-width: none;
            }
          }
        </style>
      </head>
      <body>
        <div class="page">
          <h1 class="title">${escapeHtml(trip.name)}</h1>
          ${dayPages}
        </div>
      </body>
    </html>`;
}

function buildCompactTripExportHtml(
  trip: Trip,
  exportDays: TripExportDay[],
  initialDay?: string,
) {
  const activeDay =
    initialDay && exportDays.some((day) => day.day === initialDay)
      ? initialDay
      : null;

  const buildDaySection = (dayEntry: TripExportDay) => {
    const orderedSegments = [...dayEntry.segments].sort(
      (left, right) =>
        timeToMinutes(left.startTime) - timeToMinutes(right.startTime),
    );

    const timelineRows: Array<{
      type: "program-start" | "segment" | "buffer" | "program-end";
      start: string;
      end: string;
      label: string;
      note?: string;
      segment?: Segment;
    }> = [];

    if (orderedSegments.length > 0) {
      const firstSegment = orderedSegments[0];
      timelineRows.push({
        type: "program-start",
        start: firstSegment.startTime,
        end: firstSegment.startTime,
        label: t("trip.programStarts", DEFAULT_LOCALE, "Program starts"),
        note: firstSegment.activityDescription,
      });
    }

    orderedSegments.forEach((segment, index) => {
      timelineRows.push({
        type: "segment",
        start: segment.startTime,
        end: segment.endTime,
        label: segment.activityDescription,
        note: segment.locationMode === "route" ? "Route" : "Location",
        segment,
      });

      const nextSegment = orderedSegments[index + 1];
      if (!nextSegment) {
        return;
      }

      const gapStartMinutes = timeToMinutes(segment.endTime);
      const gapEndMinutes = timeToMinutes(nextSegment.startTime);
      if (gapEndMinutes > gapStartMinutes) {
        timelineRows.push({
          type: "buffer",
          start: segment.endTime,
          end: nextSegment.startTime,
          label: t("trip.bufferTime", DEFAULT_LOCALE, "BUFFER TIME"),
          note: `Open buffer between ${segment.activityDescription} and ${nextSegment.activityDescription}`,
        });
      }
    });

    if (orderedSegments.length > 0) {
      const lastSegment = orderedSegments[orderedSegments.length - 1];
      timelineRows.push({
        type: "program-end",
        start: lastSegment.endTime,
        end: lastSegment.endTime,
        label: t("trip.programEnds", DEFAULT_LOCALE, "Program ends"),
        note: lastSegment.activityDescription,
      });
    }

    const renderRow = (row: (typeof timelineRows)[number]) => {
      if (row.type === "buffer") {
        return `
          <article class="segment-card compact-card">
            <div class="time-card buffer-card">
              <div class="time-badge">${escapeHtml(row.start)}</div>
              <div class="time-divider">–</div>
              <div class="time-badge">${escapeHtml(row.end)}</div>
            </div>
            <div class="segment-stack compact-stack">
              <div class="info-card compact-item buffer-card-inner">
                <div class="card-title">${escapeHtml(row.label)}</div>
              </div>
            </div>
          </article>
        `;
      }

      if (row.type === "program-start" || row.type === "program-end") {
        const isProgramStart = row.type === "program-start";
        const cardClass = isProgramStart ? "program-card" : "program-end-card";
        const innerClass = isProgramStart
          ? "program-card-inner"
          : "program-end-card-inner";
        const cardTitle = isProgramStart
          ? t("trip.programStarts", DEFAULT_LOCALE, "Program starts")
          : t("trip.programEnds", DEFAULT_LOCALE, "Program ends");

        return `
          <article class="segment-card compact-card">
            <div class="time-card ${cardClass}">
              <div class="time-badge">${escapeHtml(row.start)}</div>
            </div>
            <div class="segment-stack compact-stack">
              <div class="info-card compact-item ${innerClass}">
                <div class="card-title">${escapeHtml(cardTitle)}</div>
              </div>
            </div>
          </article>
        `;
      }

      const segment = row.segment;
      if (!segment) {
        return "";
      }

      const durationMinutes = Math.max(
        0,
        timeToMinutes(segment.endTime) - timeToMinutes(segment.startTime),
      );

      const weather =
        segment.locationMode === "single"
          ? (dayEntry.weatherBySegmentId[segment.id] ?? {
              temperatureC: null,
              precipitationMm: null,
              sky: "Unavailable",
            })
          : null;

      const compactCells: string[] = [];
      const rawDetails = segment.details ?? "";
      const compactModeLabel =
        segment.locationMode === "route"
          ? getCompactCommuteTypeLabel(segment.commuteType)
          : "";

      if (segment.locationMode === "route") {
        compactCells.push(
          `<div class="compact-metric compact-title">${escapeHtml(segment.activityDescription)}</div>`,
        );
        compactCells.push(
          `<div class="compact-metric compact-icon">${getCommuteTypeIcon(segment.commuteType)}</div>`,
        );
        compactCells.push(
          `<div class="compact-metric compact-distance">${segment.routeDistanceKm != null ? `${segment.routeDistanceKm.toFixed(1)} km` : "—"}</div>`,
        );
      } else {
        compactCells.push(
          `<div class="compact-metric compact-title">${escapeHtml(segment.activityDescription)}</div>`,
        );
        compactCells.push(
          `<div class="compact-metric compact-icon">${getWeatherIcon(weather?.sky)}</div>`,
        );
        compactCells.push(
          `<div class="compact-metric compact-temp"><span class="compact-weather-value">${weather?.temperatureC != null ? `${weather.temperatureC.toFixed(1)}°C` : "—"}</span></div>`,
        );
        compactCells.push(
          `<div class="compact-metric compact-rain"><span class="compact-weather-icon" aria-hidden="true">🌧️</span><span class="compact-weather-value">${weather?.precipitationMm != null ? `${weather.precipitationMm.toFixed(1)} mm` : "—"}</span></div>`,
        );
        compactCells.push(
          `<div class="compact-metric compact-time"><div class="compact-time-main">${escapeHtml(formatHumanDurationMinutes(durationMinutes))}</div></div>`,
        );
      }

      const detailsCardHtml = (() => {
        if (!rawDetails.trim()) {
          return "";
        }

        const imageUrls = extractImageUrlsFromDetails(rawDetails);

        const textHtml = rawDetails
          .replace(/!\[[^\]]*\]\((https?:\/\/[^)]+)\)/gi, "")
          .replace(/\r\n/g, "\n")
          .replace(/\n{3,}/g, "\n\n")
          .trim();

        const imageHtml = imageUrls.length
          ? imageUrls
              .map(
                (imageUrl) =>
                  `<div class="details-image-wrap"><img src="${escapeHtml(imageUrl)}" alt="Additional detail" loading="lazy" /></div>`,
              )
              .join("")
          : "";

        const renderedTextHtml = textHtml
          ? textHtml
              .split("\n")
              .map((line) => {
                const parenthesizedLinkMatch = line.match(
                  /^(.+?)\s*\((https?:\/\/[^\s)<>]+)\)$/,
                );
                if (parenthesizedLinkMatch) {
                  const label = parenthesizedLinkMatch[1].trim();
                  const linkUrl = parenthesizedLinkMatch[2].replace(
                    /[),.!?]+$/,
                    "",
                  );
                  return `<a href="${escapeHtml(linkUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)}</a>`;
                }

                const labelUrlMatch = line.match(
                  /^(.+?)\s*(?:-|–|—)\s*(https?:\/\/[^\s<>]+)$/,
                );
                if (labelUrlMatch) {
                  const label = labelUrlMatch[1].trim();
                  const linkUrl = labelUrlMatch[2].replace(/[),.!?]+$/, "");
                  return `<a href="${escapeHtml(linkUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)}</a>`;
                }

                return escapeHtml(line)
                  .replace(/^#{1,6}\s*(.+)$/gm, "<strong>$1</strong>")
                  .replace(/\*\*(.+?)\*\*/g, "<em>$1</em>");
              })
              .join("<br />")
          : "";

        const textBlock = renderedTextHtml ? `<p>${renderedTextHtml}</p>` : "";

        return `
          <div class="compact-details-card">
            <div class="details-image-stack">${imageHtml}</div>
            ${textBlock}
          </div>
        `;
      })();

      const elapsedTimeText =
        segment.locationMode === "route"
          ? formatHumanDurationMinutes(
              segment.routeTravelMinutes ?? durationMinutes,
            )
          : formatHumanDurationMinutes(durationMinutes);

      return `
        <article class="segment-card compact-card">
          <div class="time-card">
            <div class="time-badge">${escapeHtml(segment.startTime)}</div>
            <div class="time-badge compact-elapsed">(${escapeHtml(elapsedTimeText)})</div>
            <div class="time-badge">${escapeHtml(segment.endTime)}</div>
          </div>

          <div class="segment-stack compact-stack">
            <div class="info-card compact-item compact-merged-card">
              <div class="compact-card-content">
                <div class="compact-grid ${segment.locationMode === "single" ? "five" : "four"}">
                  ${compactCells.join("")}
                </div>
                ${detailsCardHtml}
              </div>
            </div>
          </div>
        </article>
      `;
    };

    const segmentsHtml =
      timelineRows.length > 0
        ? timelineRows.map((row) => renderRow(row)).join("")
        : "<div class='empty-day'>No scheduled segments for this day.</div>";

    return `
      <section class="day-card compact-day-card">
        ${segmentsHtml}
      </section>
    `;
  };

  const dayPanelsMarkup = exportDays
    .map(
      (dayEntry) => `
        <section class="compact-day-page" data-day="${escapeHtml(dayEntry.day)}">
          <div class="compact-day-header">
            <span>${escapeHtml(formatExportDate(dayEntry.day))}</span>
          </div>
          ${buildDaySection(dayEntry)}
        </section>
      `,
    )
    .join("");

  return `<!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>${escapeHtml(trip.name)} export</title>
        <style>
          :root {
            --page-bg: #ffffff;
            --surface: #f3f4f6;
            --surface-strong: #e5e7eb;
            --text: #111827;
            --muted: #374151;
            --soft: #6b7280;
          }
          * { box-sizing: border-box; }
          body {
            margin: 0;
            background: var(--page-bg);
            color: var(--text);
            font-family: Arial, Helvetica, sans-serif;
            padding: 30px 24px;
          }
          .page {
            position: relative;
            max-width: 1100px;
            margin: 0 auto;
            background: #ffffff;
            color: var(--text);
            padding: 0;
            min-height: 100vh;
          }
          .page-content {
            position: relative;
            z-index: 1;
          }
          .hero {
            display: flex;
            align-items: center;
            justify-content: flex-start;
            gap: 18px;
            margin-bottom: 18px;
            padding-bottom: 12px;
          }
          .hero h1 {
            margin: 0;
            font-size: 30px;
            letter-spacing: -0.04em;
            color: var(--text);
          }
          .compact-day-page {
            page-break-before: always;
            break-before: page;
            margin-top: 12px;
          }
          .compact-day-page:first-child {
            page-break-before: auto;
            break-before: auto;
            margin-top: 0;
          }
          .compact-day-header {
            background: #111827;
            color: #ffffff;
            font-weight: 700;
            font-size: 18px;
            padding: 10px 14px;
            border-radius: 8px 8px 0 0;
            margin: 0 0 12px 0;
          }
          .compact-day-card {
            background: #ffffff;
            padding: 0;
          }
          .segment-card {
            display: grid;
            grid-template-columns: 96px minmax(0, 1fr);
            gap: 12px;
            align-items: stretch;
            margin-top: 4px;
            background: #ffffff;
            padding: 0;
          }
          .time-card {
            display: flex;
            flex-direction: column;
            align-items: flex-start;
            justify-content: flex-start;
            min-height: 100%;
            background: var(--surface);
            padding: 16px 10px;
            text-align: left;
          }
          .segment-stack.compact-stack {
            display: flex;
            align-items: stretch;
            min-height: 100%;
          }
          .segment-stack.compact-stack > .info-card {
            width: 100%;
            min-height: 100%;
            display: flex;
            align-items: center;
          }
          .time-badge {
            width: 100%;
            font-size: 16px;
            font-weight: 700;
            color: var(--text);
            line-height: 1.2;
            text-align: center;
          }
          .compact-elapsed {
            font-size: 11px;
            font-weight: 600;
            color: var(--soft);
            line-height: 1.2;
          }
          .time-divider {
            color: var(--soft);
            font-size: 18px;
            padding: 4px 0;
          }
          .segment-stack {
            display: grid;
            gap: 4px;
          }
          .info-card {
            background: var(--surface);
            padding: 2px 14px;
          }
          .compact-details-card {
            background: transparent;
            padding: 0;
            display: flex;
            flex-direction: column;
            gap: 8px;
          }
          .compact-details-card p {
            margin: 0;
            color: var(--text);
            line-height: 1.4;
          }
          .details-image-stack {
            display: flex;
            flex-direction: column;
            gap: 8px;
            width: 100%;
          }
          .compact-details-card .details-image-wrap {
            margin: 0;
            border-radius: 8px;
            overflow: hidden;
            background: #f3f4f6;
          }
          .compact-details-card .details-image-wrap img {
            display: block;
            width: 100%;
            height: 160px;
            object-fit: cover;
            object-position: center;
            background: #ffffff;
          }
          .compact-item {
            padding: 8px 12px;
            min-height: 100%;
            display: flex;
            align-items: stretch;
          }
          .compact-card-content {
            width: 100%;
            display: flex;
            flex-direction: column;
            gap: 8px;
          }
          .compact-item .card-title {
            font-size: 15px;
            font-weight: 700;
            margin-bottom: 0;
            width: 100%;
          }
          .compact-card {
            margin-bottom: 10px;
          }
          .compact-merged-card {
            background: #f4e4c9;
          }
          .compact-grid {
            display: grid;
            grid-template-columns: minmax(0, 1.4fr) minmax(52px, auto) minmax(70px, auto);
            gap: 8px;
            align-items: stretch;
            width: 100%;
          }
          .compact-grid.five {
            grid-template-columns: minmax(0, 1.4fr) minmax(52px, auto) minmax(72px, auto) minmax(148px, auto) minmax(74px, auto);
          }
          .compact-metric {
            display: flex;
            flex-direction: column;
            gap: 4px;
            min-height: 52px;
            justify-content: center;
            padding: 7px 7px;
            background: rgba(255,255,255,0.28);
            border-radius: 8px;
            color: var(--text);
            font-size: 12px;
            line-height: 1.3;
            word-break: break-word;
          }
          .compact-title {
            font-size: 15px;
            font-weight: 700;
            justify-self: stretch;
            text-align: left;
            min-width: 0;
          }
          .compact-icon,
          .compact-distance {
            justify-self: end;
            align-self: stretch;
            text-align: right;
            white-space: nowrap;
          }
          .compact-icon {
            font-size: 24px;
            line-height: 1;
            text-align: center;
            width: 100%;
          }
          .compact-distance {
            font-size: 12px;
            font-weight: 600;
            display: flex;
            align-items: center;
            justify-content: center;
          }
          .compact-temp,
          .compact-rain {
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 5px;
            font-size: 15px;
            font-weight: 700;
            text-align: center;
            white-space: nowrap;
          }
          .compact-rain {
            min-width: 148px;
            flex-direction: row;
          }
          .compact-weather-icon {
            font-size: 18px;
            line-height: 1;
          }
          .compact-weather-value {
            font-size: 15px;
            font-weight: 700;
            line-height: 1.2;
          }
          .compact-time-main {
            text-align: center;
            font-size: 12px;
            line-height: 1.3;
            font-weight: 700;
          }
          .compact-time-subtype {
            text-align: center;
            font-size: 11px;
            color: var(--soft);
            line-height: 1.2;
            font-weight: 600;
          }
          .program-card,
          .program-card-inner {
            background: #dff7d7 !important;
            color: #000000;
          }
          .buffer-card,
          .buffer-card-inner {
            background: #dfeeff !important;
            color: #000000;
          }
          .program-end-card,
          .program-end-card-inner {
            background: #f9d7d7 !important;
            color: #000000;
          }
          .program-card,
          .buffer-card,
          .program-end-card {
            display: flex;
            align-items: center;
          }
          .program-card-inner,
          .buffer-card-inner,
          .program-end-card-inner {
            display: flex;
            align-items: center;
            min-height: 100%;
          }
          .program-card-inner .card-title,
          .buffer-card-inner .card-title,
          .program-end-card-inner .card-title {
            margin-bottom: 0;
          }
          .empty-day {
            color: var(--soft);
            font-style: italic;
            background: var(--surface);
            padding: 12px 14px;
          }
          @media print {
            body {
              background: #ffffff;
              padding: 0;
            }
            .page {
              max-width: none;
              background: #ffffff;
              color: var(--text);
            }
          }
        </style>
      </head>
      <body>
        <div class="page">
          <div class="page-content">
            <div class="hero">
              <h1>${escapeHtml(trip.name)}</h1>
            </div>

            ${dayPanelsMarkup}
          </div>
        </div>
      </body>
    </html>`;
}

export default function HomeScreen() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const isDesktopOverlay = Platform.OS === "web" && width >= 1024;
  const isWideTripWorkspace = width >= 1180;
  const [trips, setTrips] = useState<Trip[]>([]);
  const [form, setForm] = useState<TripFormState>({
    name: "",
    startDate: "",
    endDate: "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showStartPicker, setShowStartPicker] = useState(false);
  const [showEndPicker, setShowEndPicker] = useState(false);
  const [selectedTripId, setSelectedTripId] = useState<string | null>(null);
  const [showTripDropdown, setShowTripDropdown] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [calendarStartDate, setCalendarStartDate] = useState<
    string | undefined
  >(undefined);
  const [calendarEndDate, setCalendarEndDate] = useState<string | undefined>(
    undefined,
  );
  const [selectedDay, setSelectedDay] = useState<string | undefined>(undefined);
  const [draggingSegmentId, setDraggingSegmentId] = useState<string | null>(
    null,
  );
  const [shareUserPickerOpen, setShareUserPickerOpen] = useState(false);
  const [shareUsers, setShareUsers] = useState<
    Array<{ uid: string; email: string }>
  >([]);

  const loadTrips = useCallback(async () => {
    try {
      const storedTrips = await readTripsFromFile();
      setTrips(sortTripsByStartDate(storedTrips));
    } catch {
      setError("Could not load your saved trips.");
    }
  }, []);

  useEffect(() => {
    loadTrips();
  }, [loadTrips]);

  useFocusEffect(
    useCallback(() => {
      loadTrips();
    }, [loadTrips]),
  );

  const sortedTrips = sortTripsByStartDate(trips);
  const selectedTrip =
    sortedTrips.find((trip) => trip.id === selectedTripId) ?? null;

  useEffect(() => {
    if (selectedTrip) {
      setCalendarStartDate(selectedTrip.startDate);
      setCalendarEndDate(selectedTrip.endDate);
      setSelectedDay((current) => {
        if (
          current &&
          current >= selectedTrip.startDate &&
          current <= selectedTrip.endDate
        ) {
          return current;
        }

        return selectedTrip.startDate;
      });
      return;
    }

    if (showForm) {
      setCalendarStartDate(
        isValidDate(form.startDate) ? form.startDate : undefined,
      );
      setCalendarEndDate(isValidDate(form.endDate) ? form.endDate : undefined);
      return;
    }

    setCalendarStartDate(undefined);
    setCalendarEndDate(undefined);
    setSelectedDay(undefined);
  }, [selectedTrip, showForm, form.startDate, form.endDate]);

  const openCreateFormFromCalendar = () => {
    if (!calendarStartDate || !calendarEndDate) {
      return;
    }

    setShowForm(true);
    setIsEditing(false);
    setSelectedTripId(null);
    setShowTripDropdown(false);
    setForm({
      name: "",
      startDate: calendarStartDate,
      endDate: calendarEndDate,
    });
    setError(null);
  };

  const handleSelectTrip = (tripId: string | null) => {
    setSelectedTripId(tripId);
    setShowTripDropdown(false);
    setShowForm(false);
    setIsEditing(false);
    setError(null);
  };

  const handleEditTrip = () => {
    if (!selectedTrip) {
      console.log("no trip selected");
      return;
    }

    setShowForm(true);
    setIsEditing(true);
    setForm({
      name: selectedTrip.name,
      startDate: selectedTrip.startDate,
      endDate: selectedTrip.endDate,
    });
    setError(null);
  };

  const handleCancelForm = () => {
    setShowForm(false);
    setIsEditing(false);
    setForm({ name: "", startDate: "", endDate: "" });
    setError(null);
  };

  const handleSaveTrip = async () => {
    const trimmedName = form.name.trim();
    const trimmedStart = form.startDate.trim();
    const trimmedEnd = form.endDate.trim();

    if (!trimmedName || !trimmedStart || !trimmedEnd) {
      setError("Please fill in the trip name, start date, and end date.");
      return;
    }

    if (!isValidDate(trimmedStart) || !isValidDate(trimmedEnd)) {
      setError("Please use dates in YYYY-MM-DD format.");
      return;
    }

    if (
      new Date(`${trimmedEnd}T00:00:00`) < new Date(`${trimmedStart}T00:00:00`)
    ) {
      setError("The end date must be on or after the start date.");
      return;
    }

    const tripToSave: Trip =
      isEditing && selectedTrip
        ? {
            ...selectedTrip,
            name: trimmedName,
            startDate: trimmedStart,
            endDate: trimmedEnd,
          }
        : {
            id: `${Date.now()}`,
            name: trimmedName,
            startDate: trimmedStart,
            endDate: trimmedEnd,
          };

    const updatedTrips =
      isEditing && selectedTrip
        ? sortedTrips.map((trip) =>
            trip.id === selectedTrip.id ? tripToSave : trip,
          )
        : [tripToSave, ...sortedTrips];

    const orderedTrips = sortTripsByStartDate(updatedTrips);
    setTrips(orderedTrips);
    setSelectedTripId(tripToSave.id);
    setShowForm(false);
    setIsEditing(false);
    setForm({ name: "", startDate: "", endDate: "" });
    setCalendarStartDate(tripToSave.startDate);
    setCalendarEndDate(tripToSave.endDate);
    setSelectedDay(tripToSave.startDate);
    setError(null);
    setSaving(true);

    try {
      await writeTripsToFile(orderedTrips);
    } catch {
      setError("The trip was saved locally but could not be persisted.");
    } finally {
      setSaving(false);
    }
  };

  const handleRemoveTrip = async (tripId: string) => {
    const updatedTrips = sortedTrips.filter((trip) => trip.id !== tripId);
    setTrips(updatedTrips);
    setSelectedTripId((current) => (current === tripId ? null : current));
    setError(null);
    setSaving(true);

    try {
      await writeTripsToFile(updatedTrips);
    } catch {
      setError("The trip could not be removed from storage.");
    } finally {
      setSaving(false);
    }
  };

  const handleCalendarRangeChange = useCallback(
    (startDate?: string, endDate?: string) => {
      setCalendarStartDate(startDate);
      setCalendarEndDate(endDate);

      if (!showForm) {
        return;
      }

      setForm((current) => ({
        ...current,
        startDate: startDate ?? "",
        endDate: endDate ?? "",
      }));
    },
    [showForm],
  );

  const handleActiveDayChange = useCallback((day: string) => {
    setSelectedDay(day);
  }, []);

  const handleCloseTrip = () => {
    setSelectedTripId(null);
    setShowForm(false);
    setIsEditing(false);
  };

  const fetchRegularUsers = useCallback(async () => {
    if (!db) {
      return [] as Array<{ uid: string; email: string }>;
    }

    try {
      const snapshot = await getDocs(collection(db, "users"));
      return snapshot.docs
        .map((docSnapshot) => {
          const data = docSnapshot.data();
          const email = typeof data.email === "string" ? data.email.trim() : "";
          const role = typeof data.role === "string" ? data.role.trim() : "";
          return { uid: docSnapshot.id, email, role };
        })
        .filter((item) => item.role === "user" && item.email)
        .sort((left, right) => left.email.localeCompare(right.email))
        .map(({ uid, email }) => ({ uid, email }));
    } catch (error) {
      console.warn("Failed to load regular users for report sharing:", error);
      return [] as Array<{ uid: string; email: string }>;
    }
  }, []);

  const handleShareHtmlSelection = useCallback(async () => {
    if (!selectedTrip) {
      return;
    }

    const users = await fetchRegularUsers();
    if (users.length === 0) {
      Alert.alert(
        "No regular users available",
        "There are no regular user accounts to share the HTML report with yet.",
      );
      return;
    }

    setShareUsers(users);
    setShareUserPickerOpen(true);
  }, [fetchRegularUsers, selectedTrip]);

  const handleShareTripExport = useCallback(async () => {
    if (!selectedTrip) {
      return;
    }

    try {
      const tripDays = enumerateDays(
        selectedTrip.startDate,
        selectedTrip.endDate,
      );
      const exportDays: TripExportDay[] = await Promise.all(
        tripDays.map(async (day) => {
          const segments = getTripSegments(selectedTrip, day);
          const weatherBySegmentId = Object.fromEntries(
            await Promise.all(
              segments.map(async (segment) => {
                const weather = await fetchTripExportWeather(segment, day);
                return [segment.id, weather] as const;
              }),
            ),
          );

          return {
            day,
            segments,
            weatherBySegmentId,
          };
        }),
      );

      const exportTrip: Trip = {
        ...selectedTrip,
      };

      const html = buildMobileShareTripExportHtml(
        exportTrip,
        exportDays,
        selectedDay ?? selectedTrip.startDate,
      );
      const safeFileName = `${selectedTrip.name || "trip"}`
        .trim()
        .replace(/[^a-zA-Z0-9-_ ]+/g, "")
        .replace(/\s+/g, "-")
        .toLowerCase();
      const shareTitle = selectedTrip.name || "Trip export";
      const htmlFileName = `${safeFileName || "trip-export"}.html`;

      if (Platform.OS === "web") {
        const preparedFile = new File([html], htmlFileName, {
          type: "text/html;charset=utf-8",
        });
        const webShareSupported =
          typeof navigator !== "undefined" &&
          typeof navigator.share === "function" &&
          window.isSecureContext &&
          typeof navigator.canShare === "function" &&
          navigator.canShare({ files: [preparedFile] });

        if (webShareSupported) {
          await navigator.share({
            title: shareTitle,
            text: `Here is my trip plan: ${shareTitle}`,
            files: [preparedFile],
          });
          return;
        }

        const blob = new Blob([html], { type: "text/html;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = htmlFileName;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
        return;
      }

      const exportDirectory =
        FileSystem.documentDirectory ?? FileSystem.cacheDirectory;
      if (!exportDirectory) {
        throw new Error("No writable export directory available.");
      }

      const fileUri = `${exportDirectory}${htmlFileName}`;
      await FileSystem.writeAsStringAsync(fileUri, html, {
        encoding: FileSystem.EncodingType.UTF8,
      });

      const isAvailable = await Sharing.isAvailableAsync();
      if (!isAvailable) {
        Alert.alert(
          "Sharing unavailable",
          "Sharing is not available on this device right now.",
        );
        return;
      }

      await Sharing.shareAsync(fileUri, {
        dialogTitle: `Share ${shareTitle}`,
        mimeType: "text/html",
        UTI: "public.html",
      });
    } catch (error) {
      console.error("[TripExportShare] Share failed", error);
      setError("The export could not be shared. Please try again.");
    }
  }, [selectedTrip, selectedDay]);

  /* eslint-disable react-hooks/preserve-manual-memoization */
  const handleExportTrip = useCallback(async () => {
    if (!selectedTrip || Platform.OS !== "web") {
      if (!selectedTrip) {
        return;
      }

      Alert.alert(
        "Export available on web",
        "Open this trip in the browser to print a PDF version.",
      );
      return;
    }

    const printWindow = window.open(
      "about:blank",
      "_blank",
      "width=1200,height=900",
    );
    if (!printWindow) {
      setError(
        "The browser blocked the export window. Please allow pop-ups and try again.",
      );
      return;
    }

    try {
      const tripDays = enumerateDays(
        selectedTrip.startDate,
        selectedTrip.endDate,
      );
      const exportDays: TripExportDay[] = await Promise.all(
        tripDays.map(async (day) => {
          const segments = getTripSegments(selectedTrip, day);
          const weatherBySegmentId = Object.fromEntries(
            await Promise.all(
              segments.map(async (segment) => {
                const weather = await fetchTripExportWeather(segment, day);
                return [segment.id, weather] as const;
              }),
            ),
          );

          return {
            day,
            segments,
            weatherBySegmentId,
          };
        }),
      );

      const exportTrip: Trip = {
        ...selectedTrip,
      };

      const html = buildTripExportHtml(
        exportTrip,
        exportDays,
        selectedDay ?? selectedTrip.startDate,
      );
      const exportDoc = printWindow.document;

      exportDoc.open();
      exportDoc.write(html);
      exportDoc.close();
      printWindow.focus();
    } catch (error) {
      console.error("[TripExport] Export failed", error);
      setError("The export could not be prepared. Please try again.");
    }
  }, [selectedTrip, selectedDay]);

  const handleExportTripCompact = useCallback(async () => {
    await handleShareHtmlSelection();
  }, [handleShareHtmlSelection]);

  const handleShareSelectedUserReport = useCallback(
    async (selectedUser: { uid: string; email: string }) => {
      if (!selectedTrip) {
        return;
      }

      setShareUserPickerOpen(false);

      try {
        const tripDays = enumerateDays(
          selectedTrip.startDate,
          selectedTrip.endDate,
        );
        const exportDays: TripExportDay[] = await Promise.all(
          tripDays.map(async (day) => {
            const segments = getTripSegments(selectedTrip, day);
            const weatherBySegmentId = Object.fromEntries(
              await Promise.all(
                segments.map(async (segment) => {
                  const weather = await fetchTripExportWeather(segment, day);
                  return [segment.id, weather] as const;
                }),
              ),
            );

            return {
              day,
              segments,
              weatherBySegmentId,
            };
          }),
        );

        const exportTrip: Trip = {
          ...selectedTrip,
        };

        const html = buildMobileShareTripExportHtml(
          exportTrip,
          exportDays,
          selectedDay ?? selectedTrip.startDate,
        );
        const safeFileName = `${selectedTrip.name || "trip"}`
          .trim()
          .replace(/[^a-zA-Z0-9-_ ]+/g, "")
          .replace(/\s+/g, "-")
          .toLowerCase();
        const recipientSuffix = selectedUser.email
          .trim()
          .toLowerCase()
          .replace(/[^a-z0-9@._-]+/g, "-")
          .replace(/-+/g, "-");
        const htmlFileName = `${safeFileName || "trip-export"}-${recipientSuffix || "user"}.html`;
        const shareTitle = `${selectedTrip.name || "Trip export"} for ${selectedUser.email}`;

        if (Platform.OS === "web") {
          const preparedFile = new File([html], htmlFileName, {
            type: "text/html;charset=utf-8",
          });
          const webShareSupported =
            typeof navigator !== "undefined" &&
            typeof navigator.share === "function" &&
            window.isSecureContext &&
            typeof navigator.canShare === "function" &&
            navigator.canShare({ files: [preparedFile] });

          if (webShareSupported) {
            await navigator.share({
              title: shareTitle,
              text: `Trip plan for ${selectedUser.email}`,
              files: [preparedFile],
            });
            return;
          }

          const blob = new Blob([html], { type: "text/html;charset=utf-8" });
          const url = URL.createObjectURL(blob);
          const link = document.createElement("a");
          link.href = url;
          link.download = htmlFileName;
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
          URL.revokeObjectURL(url);
          return;
        }

        const exportDirectory =
          FileSystem.documentDirectory ?? FileSystem.cacheDirectory;
        if (!exportDirectory) {
          throw new Error("No writable export directory available.");
        }

        const fileUri = `${exportDirectory}${htmlFileName}`;
        await FileSystem.writeAsStringAsync(fileUri, html, {
          encoding: FileSystem.EncodingType.UTF8,
        });

        const isAvailable = await Sharing.isAvailableAsync();
        if (!isAvailable) {
          Alert.alert(
            "Sharing unavailable",
            "Sharing is not available on this device right now.",
          );
          return;
        }

        await Sharing.shareAsync(fileUri, {
          dialogTitle: `Share ${shareTitle}`,
          mimeType: "text/html",
          UTI: "public.html",
        });
      } catch (error) {
        console.error("[TripExportShare] Share failed", error);
        setError("The HTML report could not be shared. Please try again.");
      }
    },
    [selectedDay, selectedTrip],
  );

  const handleExportTripDailySchedule = useCallback(async () => {
    if (!selectedTrip || Platform.OS !== "web") {
      if (!selectedTrip) {
        return;
      }

      Alert.alert(
        "Export available on web",
        "Open this trip in the browser to print a daily schedule.",
      );
      return;
    }

    const printWindow = window.open(
      "about:blank",
      "_blank",
      "width=1200,height=900",
    );
    if (!printWindow) {
      setError(
        "The browser blocked the export window. Please allow pop-ups and try again.",
      );
      return;
    }

    try {
      const tripDays = enumerateDays(
        selectedTrip.startDate,
        selectedTrip.endDate,
      );
      const exportDays: TripExportDay[] = await Promise.all(
        tripDays.map(async (day) => {
          const segments = getTripSegments(selectedTrip, day);
          const weatherBySegmentId = Object.fromEntries(
            await Promise.all(
              segments.map(async (segment) => {
                const weather = await fetchTripExportWeather(segment, day);
                return [segment.id, weather] as const;
              }),
            ),
          );

          return {
            day,
            segments,
            weatherBySegmentId,
          };
        }),
      );

      const html = buildDailyScheduleTripExportHtml(selectedTrip, exportDays);
      const exportDoc = printWindow.document;

      exportDoc.open();
      exportDoc.write(html);
      exportDoc.close();
      printWindow.focus();
    } catch (error) {
      console.error("[TripExportDailySchedule] Export failed", error);
      setError(
        "The daily schedule export could not be prepared. Please try again.",
      );
    }
  }, [selectedTrip, selectedDay]);

  /* eslint-enable react-hooks/preserve-manual-memoization */

  const updateFormDate = (field: "startDate" | "endDate", value: string) => {
    setForm((current) => {
      const next = { ...current, [field]: value };
      const nextStart = isValidDate(next.startDate)
        ? next.startDate
        : undefined;
      const nextEnd = isValidDate(next.endDate) ? next.endDate : undefined;

      setCalendarStartDate(nextStart);
      setCalendarEndDate(nextEnd);

      return next;
    });
  };

  const hasValidCalendarRange =
    Boolean(calendarStartDate) &&
    Boolean(calendarEndDate) &&
    calendarEndDate! >= calendarStartDate!;

  const tripDays = selectedTrip
    ? enumerateDays(selectedTrip.startDate, selectedTrip.endDate)
    : [];
  const selectedDaySegments = getTripSegments(selectedTrip, selectedDay);
  const availableDaySegments = getAvailableSegments(selectedTrip, selectedDay);

  useEffect(() => {
    setDraggingSegmentId(null);
  }, [selectedTripId, selectedDay]);

  const persistTrips = useCallback(
    async (nextTrips: Trip[], failureMessage: string) => {
      const orderedTrips = sortTripsByStartDate(nextTrips);
      setTrips(orderedTrips);
      setSaving(true);
      setError(null);

      try {
        await writeTripsToFile(orderedTrips);
      } catch {
        setError(failureMessage);
      } finally {
        setSaving(false);
      }
    },
    [],
  );

  const handleEditSegment = (segment: Segment) => {
    if (!selectedTrip || !selectedDay) {
      return;
    }

    router.push({
      pathname: "/explore",
      params: {
        tripId: selectedTrip.id,
        day: selectedDay,
        segmentId: segment.id,
      },
    });
  };

  const handleDeleteSegment = async (segment: Segment) => {
    if (!selectedTrip || !selectedDay) {
      return;
    }

    const nextTrip: Trip = {
      ...selectedTrip,
      days: {
        ...(selectedTrip.days ?? {}),
        [selectedDay]: {
          segments: getTripSegments(selectedTrip, selectedDay).filter(
            (candidate) => candidate.id !== segment.id,
          ),
          availableSegments: getAvailableSegments(
            selectedTrip,
            selectedDay,
          ).filter((candidate) => candidate.id !== segment.id),
        },
      },
    };

    await persistTrips(
      trips.map((trip) => (trip.id === selectedTrip.id ? nextTrip : trip)),
      "The segment was removed locally but could not be persisted.",
    );

    setDraggingSegmentId((current) =>
      current === segment.id ? null : current,
    );
  };

  const handleReturnSegmentToList = async (segmentId: string) => {
    if (!selectedTrip || !selectedDay) {
      return;
    }

    const currentSegments = getTripSegments(selectedTrip, selectedDay);
    const currentAvailableSegments = getAvailableSegments(
      selectedTrip,
      selectedDay,
    );
    const segmentToReturn = currentSegments.find(
      (segment) => segment.id === segmentId,
    );

    if (!segmentToReturn) {
      return;
    }

    const durationMinutes =
      timeToMinutes(segmentToReturn.endTime) -
      timeToMinutes(segmentToReturn.startTime);
    const unscheduledSegment: Segment = {
      ...segmentToReturn,
      startTime: "00:00",
      endTime: minutesToTime(durationMinutes),
    };

    const nextTrip: Trip = {
      ...selectedTrip,
      days: {
        ...(selectedTrip.days ?? {}),
        [selectedDay]: {
          segments: currentSegments.filter(
            (segment) => segment.id !== segmentId,
          ),
          availableSegments: sortSegmentsByTime([
            ...currentAvailableSegments.filter(
              (segment) => segment.id !== segmentId,
            ),
            unscheduledSegment,
          ]),
        },
      },
    };

    await persistTrips(
      trips.map((trip) => (trip.id === selectedTrip.id ? nextTrip : trip)),
      "The segment was moved locally but could not be persisted.",
    );

    setDraggingSegmentId(null);
  };

  const handleDropSegment = async (segmentId: string, blockStart: string) => {
    if (!selectedTrip || !selectedDay) {
      return;
    }

    const currentSegments = getTripSegments(selectedTrip, selectedDay);
    const currentAvailableSegments = getAvailableSegments(
      selectedTrip,
      selectedDay,
    );
    const scheduledSegment = currentSegments.find(
      (segment) => segment.id === segmentId,
    );
    const availableSegment = currentAvailableSegments.find(
      (segment) => segment.id === segmentId,
    );
    const segmentToMove = scheduledSegment ?? availableSegment;

    if (!segmentToMove) {
      return;
    }

    const durationMinutes =
      timeToMinutes(segmentToMove.endTime) -
      timeToMinutes(segmentToMove.startTime);
    const nextStartMinutes = timeToMinutes(blockStart);
    const nextEndMinutes = nextStartMinutes + durationMinutes;

    if (nextEndMinutes > 24 * 60) {
      setError("That segment does not fit at the dropped time.");
      return;
    }

    const movedSegment: Segment = {
      ...segmentToMove,
      startTime: blockStart,
      endTime: minutesToTime(nextEndMinutes),
    };

    const siblingSegments = currentSegments.filter(
      (segment) => segment.id !== segmentId,
    );
    const overlaps = siblingSegments.some(
      (segment) =>
        movedSegment.startTime < segment.endTime &&
        movedSegment.endTime > segment.startTime,
    );

    if (overlaps) {
      setError(
        "That drop would overlap an existing segment on the selected day.",
      );
      return;
    }

    const nextTrip: Trip = {
      ...selectedTrip,
      days: {
        ...(selectedTrip.days ?? {}),
        [selectedDay]: {
          segments: sortSegmentsByTime(
            scheduledSegment
              ? currentSegments.map((segment) =>
                  segment.id === segmentId ? movedSegment : segment,
                )
              : [...currentSegments, movedSegment],
          ),
          availableSegments: currentAvailableSegments.filter(
            (segment) => segment.id !== segmentId,
          ),
        },
      },
    };

    await persistTrips(
      trips.map((trip) => (trip.id === selectedTrip.id ? nextTrip : trip)),
      "The segment timing was updated locally but could not be persisted.",
    );

    setDraggingSegmentId(null);
  };

  return (
    <View style={styles.backgroundRoot}>
      <ImageBackground
        source={{ uri: TRAVEL_BACKGROUND_IMAGE }}
        resizeMode="cover"
        style={styles.backgroundImage}
      />
      <View style={styles.backgroundTint} pointerEvents="none" />

      <SafeAreaView
        style={isDesktopOverlay ? styles.backgroundSafeArea : styles.safeArea}
      >
        <View style={styles.workspaceRow}>
          <ThemedView
            style={[styles.card, isDesktopOverlay && styles.overlayCard]}
          >
            <ThemedText type="title" style={styles.title}>
              Travel planner
            </ThemedText>

            {!selectedTrip ? (
              <>
                <ThemedView style={styles.selectionArea}>
                  <Pressable
                    onPress={() => setShowTripDropdown((current) => !current)}
                    style={styles.dropdownTrigger}
                  >
                    <ThemedText type="small" style={styles.dropdownLabel}>
                      No trip selected
                    </ThemedText>
                  </Pressable>
                </ThemedView>

                {showTripDropdown ? (
                  <ThemedView style={styles.dropdownMenu}>
                    <Pressable
                      onPress={() => handleSelectTrip(null)}
                      style={styles.dropdownItem}
                    >
                      <ThemedText style={styles.dropdownItemText}>
                        None selected
                      </ThemedText>
                    </Pressable>
                    {sortedTrips.map((trip) => (
                      <Pressable
                        key={trip.id}
                        onPress={() => handleSelectTrip(trip.id)}
                        style={styles.dropdownItem}
                      >
                        <ThemedText style={styles.dropdownItemText}>
                          {trip.name} — {formatDate(trip.startDate)}
                        </ThemedText>
                      </Pressable>
                    ))}
                  </ThemedView>
                ) : null}
              </>
            ) : null}

            {!selectedTrip && !showForm && hasValidCalendarRange ? (
              <Pressable
                onPress={openCreateFormFromCalendar}
                style={styles.newTripButton}
              >
                <ThemedText type="small" style={styles.newTripButtonText}>
                  New trip from selected dates
                </ThemedText>
              </Pressable>
            ) : null}

            {showForm ? (
              <ThemedView type="backgroundElement" style={styles.formBox}>
                <TextInput
                  value={form.name}
                  onChangeText={(value) =>
                    setForm((current) => ({ ...current, name: value }))
                  }
                  placeholder="Trip name"
                  autoCapitalize="words"
                  autoCorrect={false}
                  style={styles.input}
                  placeholderTextColor="#8E8E93"
                />

                {Platform.OS === "web" ? (
                  <TextInput
                    value={form.startDate}
                    onChangeText={(value) => updateFormDate("startDate", value)}
                    placeholder="Start date (YYYY-MM-DD)"
                    keyboardType="numbers-and-punctuation"
                    style={styles.input}
                    placeholderTextColor="#8E8E93"
                  />
                ) : (
                  <>
                    <Pressable
                      onPress={() => setShowStartPicker(true)}
                      style={styles.input}
                    >
                      <ThemedText style={styles.dateText}>
                        {form.startDate
                          ? formatDate(form.startDate)
                          : "Select start date"}
                      </ThemedText>
                    </Pressable>
                    {showStartPicker ? (
                      <DateTimePicker
                        value={toDateInputValue(form.startDate)}
                        mode="date"
                        display="default"
                        onChange={(
                          _: unknown,
                          selectedDate: Date | undefined,
                        ) => {
                          setShowStartPicker(false);
                          if (selectedDate) {
                            updateFormDate(
                              "startDate",
                              toDateString(selectedDate),
                            );
                          }
                        }}
                      />
                    ) : null}
                  </>
                )}

                {Platform.OS === "web" ? (
                  <TextInput
                    value={form.endDate}
                    onChangeText={(value) => updateFormDate("endDate", value)}
                    placeholder="End date (YYYY-MM-DD)"
                    keyboardType="numbers-and-punctuation"
                    style={styles.input}
                    placeholderTextColor="#8E8E93"
                  />
                ) : (
                  <>
                    <Pressable
                      onPress={() => setShowEndPicker(true)}
                      style={styles.input}
                    >
                      <ThemedText style={styles.dateText}>
                        {form.endDate
                          ? formatDate(form.endDate)
                          : "Select end date"}
                      </ThemedText>
                    </Pressable>
                    {showEndPicker ? (
                      <DateTimePicker
                        value={toDateInputValue(form.endDate)}
                        mode="date"
                        display="default"
                        onChange={(
                          _: unknown,
                          selectedDate: Date | undefined,
                        ) => {
                          setShowEndPicker(false);
                          if (selectedDate) {
                            updateFormDate(
                              "endDate",
                              toDateString(selectedDate),
                            );
                          }
                        }}
                      />
                    ) : null}
                  </>
                )}

                <ThemedView style={styles.formActionRow}>
                  <Pressable
                    onPress={handleSaveTrip}
                    disabled={saving}
                    style={[styles.button, saving && styles.buttonDisabled]}
                  >
                    {saving ? (
                      <ActivityIndicator color="#ffffff" />
                    ) : (
                      <ThemedText type="small" style={styles.buttonText}>
                        {isEditing ? "Save changes" : "Add trip"}
                      </ThemedText>
                    )}
                  </Pressable>
                  <Pressable
                    onPress={handleCancelForm}
                    style={styles.cancelButton}
                  >
                    <ThemedText style={styles.cancelButtonText}>
                      Cancel
                    </ThemedText>
                  </Pressable>
                </ThemedView>
              </ThemedView>
            ) : null}

            {error ? (
              <ThemedText style={styles.error}>{error}</ThemedText>
            ) : null}

            <PlannerPage
              startDate={calendarStartDate}
              endDate={calendarEndDate}
              activeDay={selectedDay}
              isTripLoaded={Boolean(selectedTrip)}
              compact={Boolean(selectedTrip)}
              onRangeChange={handleCalendarRangeChange}
              onActiveDayChange={handleActiveDayChange}
            />

            {selectedTrip ? (
              <ThemedView style={styles.leftDaySegmentsPanel}>
                <Pressable
                  onPress={() =>
                    router.push({
                      pathname: "/explore",
                      params: {
                        tripId: selectedTrip.id,
                        day: selectedDay ?? selectedTrip.startDate,
                      },
                    })
                  }
                  style={styles.segmentManagerButton}
                >
                  <ThemedText
                    type="small"
                    style={styles.segmentManagerButtonText}
                  >
                    Day Segment Manager
                  </ThemedText>
                </Pressable>

                {availableDaySegments.length === 0 ? (
                  <ThemedText type="small" style={styles.segmentEditorHint}>
                    Use Day Segment Manager to generate segments for this day.
                  </ThemedText>
                ) : (
                  <View style={styles.segmentListViewport}>
                    <DaySegmentList
                      segments={availableDaySegments}
                      draggingSegmentId={draggingSegmentId}
                      onDelete={handleDeleteSegment}
                      onEdit={handleEditSegment}
                      onDragStateChange={setDraggingSegmentId}
                      onDropSegmentToList={handleReturnSegmentToList}
                    />
                  </View>
                )}
              </ThemedView>
            ) : null}
          </ThemedView>

          {shareUserPickerOpen ? (
            <View style={styles.shareOverlay}>
              <View style={styles.shareSheet}>
                <ThemedText type="subtitle" style={styles.shareTitle}>
                  Share HTML report
                </ThemedText>
                <ThemedText type="small" style={styles.shareSubtitle}>
                  Select a regular user to receive the daily plan.
                </ThemedText>

                {shareUsers.map((user) => (
                  <Pressable
                    key={user.uid}
                    onPress={() => handleShareSelectedUserReport(user)}
                    style={styles.shareUserRow}
                  >
                    <ThemedText type="small" style={styles.shareUserText}>
                      {user.email}
                    </ThemedText>
                  </Pressable>
                ))}

                <Pressable
                  onPress={() => setShareUserPickerOpen(false)}
                  style={styles.shareCancelButton}
                >
                  <ThemedText type="small" style={styles.shareCancelText}>
                    Cancel
                  </ThemedText>
                </Pressable>
              </View>
            </View>
          ) : null}

          {selectedTrip ? (
            <ThemedView
              style={[
                styles.tripWorkspaceCard,
                isDesktopOverlay && styles.tripWorkspaceCardDesktop,
              ]}
            >
              <ThemedView style={styles.tripWorkspaceHeader}>
                <ThemedText type="subtitle" style={styles.tripWorkspaceTitle}>
                  {selectedTrip.name}
                </ThemedText>
                <ThemedView style={styles.headerActions}>
                  <Pressable
                    onPress={handleExportTrip}
                    style={styles.headerActionButton}
                  >
                    <ThemedText type="small" style={styles.headerActionText}>
                      Export
                    </ThemedText>
                  </Pressable>
                  <Pressable
                    onPress={handleExportTripCompact}
                    style={styles.headerActionButton}
                  >
                    <ThemedText type="small" style={styles.headerActionText}>
                      Share HTML
                    </ThemedText>
                  </Pressable>
                  <Pressable
                    onPress={handleExportTripDailySchedule}
                    style={styles.headerActionButton}
                  >
                    <ThemedText type="small" style={styles.headerActionText}>
                      Daily schedule
                    </ThemedText>
                  </Pressable>
                  <Pressable
                    onPress={handleShareTripExport}
                    style={styles.headerActionButton}
                  >
                    <ThemedText type="small" style={styles.headerActionText}>
                      Share to phone
                    </ThemedText>
                  </Pressable>
                  <Pressable
                    onPress={handleEditTrip}
                    style={styles.headerActionButton}
                  >
                    <ThemedText type="small" style={styles.headerActionText}>
                      Edit
                    </ThemedText>
                  </Pressable>
                  <Pressable
                    onPress={() => handleRemoveTrip(selectedTrip.id)}
                    style={[
                      styles.headerActionButton,
                      styles.removeActionButton,
                    ]}
                  >
                    <ThemedText type="small" style={styles.removeActionText}>
                      Remove
                    </ThemedText>
                  </Pressable>
                  <Pressable
                    onPress={handleCloseTrip}
                    style={styles.closeTripButton}
                  >
                    <ThemedText type="small" style={styles.closeTripButtonText}>
                      X
                    </ThemedText>
                  </Pressable>
                </ThemedView>
              </ThemedView>

              <ThemedView
                style={[
                  styles.dayWorkspaceRow,
                  isWideTripWorkspace && styles.dayWorkspaceRowDesktop,
                ]}
              >
                <ThemedView style={styles.dayWorkspaceTableColumn}>
                  <View style={styles.timelineViewport}>
                    <DayTimeTable
                      segments={selectedDaySegments}
                      dayDate={selectedDay ?? null}
                      draggingSegmentId={draggingSegmentId}
                      onDropSegment={handleDropSegment}
                      onDragStateChange={setDraggingSegmentId}
                      onReturnSegmentToList={handleReturnSegmentToList}
                    />
                  </View>
                </ThemedView>
              </ThemedView>
            </ThemedView>
          ) : null}
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  backgroundRoot: {
    flex: 1,
    position: "relative",
    overflow: "hidden",
  },
  backgroundImage: {
    ...StyleSheet.absoluteFill,
  },
  backgroundTint: {
    ...StyleSheet.absoluteFill,
    backgroundColor: "rgba(3, 7, 18, 0.34)",
  },
  container: {
    flex: 1,
  },
  safeArea: {
    flex: 1,
    paddingHorizontal: Spacing.four,
    justifyContent: "center",
    paddingBottom: BottomTabInset + Spacing.three,
    maxWidth: MaxContentWidth,
  },
  backgroundSafeArea: {
    flex: 1,
    justifyContent: "flex-start",
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.four,
    paddingBottom: Spacing.four,
  },
  card: {
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.five,
    borderRadius: Spacing.four,
    gap: Spacing.three,
    alignSelf: "stretch",
    backgroundColor: "#1f2937",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.05)",
  },
  overlayCard: {
    width: "46%",
    maxWidth: 480,
    minWidth: 280,
    backgroundColor: "rgba(17, 24, 39, 0.88)",
    borderColor: "rgba(255,255,255,0.12)",
    shadowColor: "#000",
    shadowOpacity: 0.25,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
  },
  workspaceRow: {
    flexDirection: "row",
    flex: 1,
    gap: Spacing.three,
    alignItems: "stretch",
  },
  title: {
    textAlign: "center",
  },
  subtitle: {
    textAlign: "center",
    opacity: 0.8,
  },
  leftDaySegmentsPanel: {
    flex: 1,
    gap: Spacing.two,
    backgroundColor: "transparent",
    borderRadius: Spacing.three,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
    padding: Spacing.three,
    minHeight: 0,
  },
  segmentListViewport: {
    flex: 1,
    minHeight: 0,
    minWidth: 0,
    overflow: "hidden",
    borderRadius: Spacing.two,
    backgroundColor: "transparent",
  },
  formBox: {
    padding: Spacing.three,
    borderRadius: Spacing.two,
    gap: Spacing.two,
    backgroundColor: "#111827",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  input: {
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    backgroundColor: "rgba(255,255,255,0.04)",
    color: "#F9FAFB",
    justifyContent: "center",
  },
  dateText: {
    color: "#F9FAFB",
  },
  button: {
    backgroundColor: "#2563EB",
    borderRadius: Spacing.two,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.four,
    alignItems: "center",
    justifyContent: "center",
  },
  buttonDisabled: {
    opacity: 0.7,
  },
  buttonText: {
    color: "#FFFFFF",
    fontWeight: "600",
  },
  error: {
    color: "#F87171",
    textAlign: "center",
  },
  backgroundDecoration: {
    position: "absolute",
    top: 24,
    right: 16,
    width: 92,
    height: 92,
    borderRadius: 46,
    backgroundColor: "rgba(59,130,246,0.12)",
  },
  backgroundDecorationSecondary: {
    position: "absolute",
    bottom: 28,
    left: 14,
    width: 60,
    height: 60,
    borderRadius: 16,
    backgroundColor: "rgba(236,72,153,0.1)",
  },
  backgroundDecorationStrip: {
    position: "absolute",
    top: 140,
    left: 24,
    width: 180,
    height: 8,
    borderRadius: 4,
    backgroundColor: "rgba(16,185,129,0.12)",
  },
  selectionArea: {
    flexDirection: "row",
    gap: Spacing.two,
    alignItems: "center",
    justifyContent: "space-between",
  },
  dropdownTrigger: {
    flex: 1,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    backgroundColor: "rgba(255,255,255,0.04)",
  },
  dropdownLabel: {
    color: "#F9FAFB",
  },
  newTripButton: {
    backgroundColor: "#3B82F6",
    borderRadius: Spacing.two,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.four,
  },
  newTripButtonText: {
    color: "#FFFFFF",
    fontWeight: "600",
  },
  dropdownMenu: {
    borderRadius: Spacing.two,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
    overflow: "hidden",
  },
  dropdownItem: {
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
  },
  dropdownItemText: {
    color: "#F9FAFB",
  },
  formActionRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: Spacing.two,
    alignItems: "center",
  },
  cancelButton: {
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.four,
  },
  cancelButtonText: {
    color: "#F9FAFB",
  },
  detailLine: {
    opacity: 0.9,
  },
  detailActions: {
    flexDirection: "row",
    gap: Spacing.two,
    justifyContent: "flex-end",
  },
  outlineButton: {
    borderWidth: 1,
    borderColor: "#F87171",
    borderRadius: Spacing.two,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.four,
  },
  outlineButtonText: {
    color: "#F87171",
  },
  tripDetail: {
    opacity: 0.8,
  },
  tripWorkspaceCard: {
    flex: 1,
    padding: Spacing.three,
    borderRadius: Spacing.four,
    backgroundColor: "rgba(17, 24, 39, 0.88)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    gap: Spacing.two,
  },
  tripWorkspaceCardDesktop: {
    flex: 1,
    minWidth: 320,
    maxWidth: undefined,
    backgroundColor: "rgba(17, 24, 39, 0.88)",
  },
  tripWorkspaceHeader: {
    height: 50,
    flexShrink: 0,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: "transparent",
  },
  tripWorkspaceTitle: {
    color: "#F9FAFB",
    flex: 1,
  },
  headerActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.one,
    backgroundColor: "transparent",
  },
  headerActionButton: {
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.2)",
    borderRadius: Spacing.two,
    paddingVertical: Spacing.half,
    paddingHorizontal: Spacing.two,
    backgroundColor: "transparent",
    height: 30,
    alignItems: "center",
    justifyContent: "center",
  },
  headerActionText: {
    color: "#F9FAFB",
    fontWeight: "600",
  },
  exportActionButton: {
    borderColor: "rgba(96, 165, 250, 0.55)",
  },
  removeActionButton: {
    borderColor: "rgba(248,113,113,0.55)",
    height: 30,
    alignItems: "center",
    justifyContent: "center",
  },
  removeActionText: {
    color: "#FCA5A5",
    fontWeight: "700",
  },
  closeTripButton: {
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.24)",
    borderRadius: Spacing.two,
    width: 30,
    height: 30,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.1)",
  },
  closeTripButtonText: {
    color: "#F9FAFB",
    fontWeight: "700",
  },
  tripWorkspaceBody: {
    minHeight: 0,
    backgroundColor: "red",
    height: "100%",
    overflow: "hidden",
  },
  dayWorkspaceRow: {
    flexDirection: "column",
    gap: Spacing.three,
    backgroundColor: "transparent",
    flex: 1,
    minHeight: 0,
  },
  dayWorkspaceRowDesktop: {
    flexDirection: "row",
    alignItems: "stretch",
  },
  shareOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(2, 6, 23, 0.72)",
    alignItems: "center",
    justifyContent: "center",
    padding: Spacing.four,
    zIndex: 50,
  },
  shareSheet: {
    width: "100%",
    maxWidth: 480,
    backgroundColor: "#111827",
    borderRadius: Spacing.three,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    padding: Spacing.four,
    gap: Spacing.two,
  },
  shareTitle: {
    color: "#F9FAFB",
  },
  shareSubtitle: {
    color: "#C7D2FE",
  },
  shareUserRow: {
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
    borderRadius: Spacing.two,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    backgroundColor: "rgba(255,255,255,0.04)",
  },
  shareUserText: {
    color: "#F9FAFB",
  },
  shareCancelButton: {
    marginTop: Spacing.one,
    alignItems: "center",
    paddingVertical: Spacing.two,
  },
  shareCancelText: {
    color: "#E2E8F0",
    fontWeight: "600",
  },
  dayWorkspaceTableColumn: {
    flex: 1,
    gap: Spacing.two,
    minHeight: 0,
    backgroundColor: "transparent",
  },
  segmentManagerButton: {
    alignSelf: "flex-start",
    borderRadius: Spacing.two,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
    backgroundColor: "#f97316",
  },
  segmentManagerButtonText: {
    color: "#fff7ed",
    fontWeight: "700",
  },
  timelinePane: {
    gap: Spacing.one,
    backgroundColor: "transparent",
  },
  timelineViewport: {
    borderRadius: Spacing.two,
    borderWidth: 0,
    backgroundColor: "transparent",
    width: "100%",
    flex: 1,
    minHeight: 0,
    overflow: "hidden",
  },
  segmentEditorTitle: {
    color: "#F9FAFB",
  },
  segmentEditorHint: {
    color: "#CBD5E1",
    lineHeight: 20,
    flex: 1,
    minHeight: 0,
  },
  segmentEditorLabel: {
    color: "#E2E8F0",
    fontWeight: "600",
  },
  segmentTypeButton: {
    borderWidth: 1,
    borderColor: "rgba(249,115,22,0.35)",
    borderRadius: Spacing.two,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
    backgroundColor: "rgba(255,237,213,0.08)",
  },
  segmentTypeButtonText: {
    color: "#FED7AA",
    fontWeight: "600",
  },
  commuteTypeRow: {
    flexDirection: "row",
    gap: Spacing.two,
    backgroundColor: "transparent",
  },
  commuteTypeButton: {
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.18)",
    borderRadius: Spacing.two,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
    backgroundColor: "rgba(255,255,255,0.06)",
  },
  commuteTypeButtonActive: {
    borderColor: "#f97316",
    backgroundColor: "rgba(249,115,22,0.18)",
  },
  commuteTypeButtonText: {
    color: "#E2E8F0",
  },
  commuteTypeButtonTextActive: {
    color: "#fff7ed",
    fontWeight: "700",
  },
  segmentEditorActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.two,
    alignItems: "center",
    backgroundColor: "transparent",
  },
  timelineContent: {
    paddingVertical: Spacing.one,
  },
  timelineRow: {
    height: TIMELINE_ROW_HEIGHT,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: Spacing.two,
    gap: Spacing.two,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.08)",
  },
  timelineLabel: {
    width: 72,
    color: "#CBD5E1",
  },
  timelineField: {
    flex: 1,
    height: 18,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "rgba(249,115,22,0.35)",
    backgroundColor: "rgba(255,237,213,0.9)",
  },
});
