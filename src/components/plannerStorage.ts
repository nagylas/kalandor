import * as FileSystem from "expo-file-system/legacy";
import { Platform } from "react-native";

import type { DayPlan, Segment } from "./plannerTypes";

export type SavedTripLocation = {
  place_id: string;
  display_name: string;
  lat: string;
  lon: string;
  type?: string;
  class?: string;
  savedAt: string;
};

export type Trip = {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  days?: Record<string, DayPlan>;
  savedLocations?: SavedTripLocation[];
  mapImageDataUrl?: string;
  mapImageName?: string;
};

const API_BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL ?? "";
const STORAGE_DIRECTORY = `${FileSystem.documentDirectory ?? FileSystem.cacheDirectory ?? ""}data/`;
const TRIPS_FILE_PATH = `${STORAGE_DIRECTORY}trips.json`;

async function fetchApi<T>(path: string, options: RequestInit = {}) {
  const url = `${API_BASE_URL}${path}`;
  const response = await fetch(url, options);
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || "Network response was not ok.");
  }
  return response.json() as Promise<T>;
}

async function ensureStorageDirectory() {
  if (Platform.OS === "web") {
    return;
  }

  if (!STORAGE_DIRECTORY) {
    throw new Error("No app storage directory is available on this device.");
  }

  await FileSystem.makeDirectoryAsync(STORAGE_DIRECTORY, {
    intermediates: true,
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function sortTripsByStartDate(trips: Trip[]) {
  return [...trips].sort((a, b) => a.startDate.localeCompare(b.startDate));
}

export function sortSegmentsByTime(segments: Segment[]) {
  return [...segments].sort(
    (a, b) =>
      a.startTime.localeCompare(b.startTime) ||
      a.endTime.localeCompare(b.endTime) ||
      a.id.localeCompare(b.id),
  );
}

function normalizeCoordinate(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return undefined;
}

function normalizeRouteMapUrl(
  segment: Pick<
    Segment,
    | "locationMode"
    | "routeMapUrl"
    | "startLocation"
    | "startLocationLat"
    | "startLocationLon"
    | "endLocation"
    | "endLocationLat"
    | "endLocationLon"
  >,
  savedLocations: SavedTripLocation[] = [],
): string | undefined {
  if (segment.routeMapUrl?.trim()) {
    return segment.routeMapUrl;
  }

  if (segment.locationMode !== "route") {
    return undefined;
  }

  const startLat =
    typeof segment.startLocationLat === "number" &&
    Number.isFinite(segment.startLocationLat)
      ? segment.startLocationLat
      : undefined;
  const startLon =
    typeof segment.startLocationLon === "number" &&
    Number.isFinite(segment.startLocationLon)
      ? segment.startLocationLon
      : undefined;
  const endLat =
    typeof segment.endLocationLat === "number" &&
    Number.isFinite(segment.endLocationLat)
      ? segment.endLocationLat
      : undefined;
  const endLon =
    typeof segment.endLocationLon === "number" &&
    Number.isFinite(segment.endLocationLon)
      ? segment.endLocationLon
      : undefined;

  if (
    typeof startLat === "number" &&
    typeof startLon === "number" &&
    typeof endLat === "number" &&
    typeof endLon === "number"
  ) {
    return `https://staticmap.openstreetmap.de/staticmap.php?center=${(startLat + endLat) / 2},${(startLon + endLon) / 2}&zoom=7&size=1000x300&maptype=mapnik&markers=${startLat},${startLon},lightblue1|${endLat},${endLon},red`;
  }

  const startMatch = savedLocations.find(
    (location) => location.display_name === segment.startLocation,
  );
  const endMatch = savedLocations.find(
    (location) => location.display_name === segment.endLocation,
  );

  if (startMatch && endMatch) {
    const startLatNumber = Number(startMatch.lat);
    const startLonNumber = Number(startMatch.lon);
    const endLatNumber = Number(endMatch.lat);
    const endLonNumber = Number(endMatch.lon);

    if (
      Number.isFinite(startLatNumber) &&
      Number.isFinite(startLonNumber) &&
      Number.isFinite(endLatNumber) &&
      Number.isFinite(endLonNumber)
    ) {
      return `https://staticmap.openstreetmap.de/staticmap.php?center=${(startLatNumber + endLatNumber) / 2},${(startLonNumber + endLonNumber) / 2}&zoom=7&size=1000x300&maptype=mapnik&markers=${startLatNumber},${startLonNumber},lightblue1|${endLatNumber},${endLonNumber},red`;
    }
  }

  return undefined;
}

function sanitizeSegment(value: unknown): Segment | null {
  if (!isRecord(value)) {
    return null;
  }

  const locationMode = value.locationMode;
  if (locationMode !== "single" && locationMode !== "route") {
    return null;
  }

  if (
    typeof value.id !== "string" ||
    typeof value.startTime !== "string" ||
    typeof value.endTime !== "string"
  ) {
    return null;
  }

  const locationLat = normalizeCoordinate(value.locationLat);
  const locationLon = normalizeCoordinate(value.locationLon);
  const startLocationLat = normalizeCoordinate(value.startLocationLat);
  const startLocationLon = normalizeCoordinate(value.startLocationLon);
  const endLocationLat = normalizeCoordinate(value.endLocationLat);
  const endLocationLon = normalizeCoordinate(value.endLocationLon);

  const parsedRouteStops = Array.isArray(value.routeStops)
    ? value.routeStops
        .map((stop) => {
          if (!isRecord(stop)) {
            return null;
          }
          const lat = normalizeCoordinate(stop.lat);
          const lon = normalizeCoordinate(stop.lon);
          const display_name =
            typeof stop.display_name === "string" ? stop.display_name : "";
          if (
            !display_name ||
            typeof lat !== "number" ||
            typeof lon !== "number"
          ) {
            return null;
          }
          return { display_name, lat, lon };
        })
        .filter(
          (stop): stop is { display_name: string; lat: number; lon: number } =>
            Boolean(stop),
        )
    : [];

  const segment: Segment = {
    id: value.id,
    startTime: value.startTime,
    endTime: value.endTime,
    activityDescription:
      typeof value.activityDescription === "string"
        ? value.activityDescription
        : "",
    details: typeof value.details === "string" ? value.details : undefined,
    locationMode,
    location: typeof value.location === "string" ? value.location : undefined,
    locationLat,
    locationLon,
    startLocation:
      typeof value.startLocation === "string" ? value.startLocation : undefined,
    startLocationLat,
    startLocationLon,
    endLocation:
      typeof value.endLocation === "string" ? value.endLocation : undefined,
    endLocationLat,
    endLocationLon,
    routeStops: parsedRouteStops.length > 0 ? parsedRouteStops : undefined,
    commuteType:
      value.commuteType === "walking" ||
      value.commuteType === "car" ||
      value.commuteType === "plane" ||
      value.commuteType === "ferry"
        ? value.commuteType
        : undefined,
    routeDistanceKm:
      typeof value.routeDistanceKm === "number" &&
      Number.isFinite(value.routeDistanceKm)
        ? value.routeDistanceKm
        : undefined,
    routeTravelMinutes:
      typeof value.routeTravelMinutes === "number" &&
      Number.isFinite(value.routeTravelMinutes)
        ? value.routeTravelMinutes
        : undefined,
    routeMapUrl:
      typeof value.routeMapUrl === "string" && value.routeMapUrl.trim()
        ? value.routeMapUrl
        : undefined,
  };

  return segment;
}

function sanitizeDayPlan(
  value: unknown,
  savedLocations: SavedTripLocation[] = [],
): DayPlan {
  const planRecord = isRecord(value) ? value : {};
  const segments = Array.isArray(planRecord.segments)
    ? planRecord.segments
        .map((segment) => {
          const sanitized = sanitizeSegment(segment);
          if (!sanitized) return null;
          if (!sanitized.routeMapUrl && sanitized.locationMode === "route") {
            sanitized.routeMapUrl = normalizeRouteMapUrl(
              sanitized,
              savedLocations,
            );
          }
          return sanitized;
        })
        .filter((segment): segment is Segment => Boolean(segment))
    : [];
  const availableSegments = Array.isArray(planRecord.availableSegments)
    ? planRecord.availableSegments
        .map((segment) => {
          const sanitized = sanitizeSegment(segment);
          if (!sanitized) return null;
          if (!sanitized.routeMapUrl && sanitized.locationMode === "route") {
            sanitized.routeMapUrl = normalizeRouteMapUrl(
              sanitized,
              savedLocations,
            );
          }
          return sanitized;
        })
        .filter((segment): segment is Segment => Boolean(segment))
    : [];

  return {
    segments: sortSegmentsByTime(segments),
    availableSegments: sortSegmentsByTime(availableSegments),
  };
}

function sanitizeTrip(value: unknown): Trip | null {
  if (!isRecord(value)) {
    return null;
  }

  if (
    typeof value.id !== "string" ||
    typeof value.name !== "string" ||
    typeof value.startDate !== "string" ||
    typeof value.endDate !== "string"
  ) {
    return null;
  }

  const savedLocations = Array.isArray(value.savedLocations)
    ? value.savedLocations
        .map((location) => {
          if (!isRecord(location)) {
            return null;
          }

          if (
            (typeof location.place_id !== "string" &&
              typeof location.place_id !== "number") ||
            typeof location.display_name !== "string" ||
            typeof location.lat !== "string" ||
            typeof location.lon !== "string"
          ) {
            return null;
          }

          const savedLocation: SavedTripLocation = {
            place_id: String(location.place_id),
            display_name: location.display_name,
            lat: location.lat,
            lon: location.lon,
            savedAt:
              typeof location.savedAt === "string" && location.savedAt
                ? location.savedAt
                : new Date().toISOString(),
          };

          if (typeof location.type === "string") {
            savedLocation.type = location.type;
          }

          if (typeof location.class === "string") {
            savedLocation.class = location.class;
          }

          return savedLocation;
        })
        .filter((location): location is SavedTripLocation => Boolean(location))
    : [];

  let days: Trip["days"];
  if (isRecord(value.days)) {
    days = Object.fromEntries(
      Object.entries(value.days).map(([day, plan]) => [
        day,
        sanitizeDayPlan(plan, savedLocations),
      ]),
    );
  }

  return {
    id: value.id,
    name: value.name,
    startDate: value.startDate,
    endDate: value.endDate,
    days,
    savedLocations,
    mapImageDataUrl:
      typeof value.mapImageDataUrl === "string"
        ? value.mapImageDataUrl
        : undefined,
    mapImageName:
      typeof value.mapImageName === "string" ? value.mapImageName : undefined,
  };
}

export function getDayPlan(
  trip: Trip | null,
  day: string | undefined,
): DayPlan {
  if (!trip || !day) {
    return { segments: [], availableSegments: [] };
  }

  return trip.days?.[day] ?? { segments: [], availableSegments: [] };
}

export function getTripSegments(trip: Trip | null, day: string | undefined) {
  return getDayPlan(trip, day).segments;
}

export function getAvailableSegments(
  trip: Trip | null,
  day: string | undefined,
) {
  return getDayPlan(trip, day).availableSegments ?? [];
}

export async function readTripsFromFile(): Promise<Trip[]> {
  if (Platform.OS === "web") {
    try {
      const response = await fetchApi<unknown[]>("/api/trips");
      if (!Array.isArray(response)) {
        return [];
      }

      return response
        .map((trip) => sanitizeTrip(trip))
        .filter((trip): trip is Trip => Boolean(trip));
    } catch {
      return [];
    }
  }

  try {
    await ensureStorageDirectory();
    const content = await FileSystem.readAsStringAsync(TRIPS_FILE_PATH);
    const parsed = JSON.parse(content);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .map((trip) => sanitizeTrip(trip))
      .filter((trip): trip is Trip => Boolean(trip));
  } catch {
    return [];
  }
}

export async function writeTripsToFile(trips: Trip[]) {
  if (Platform.OS === "web") {
    await fetchApi("/api/trips", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ trips }),
    });
    return;
  }

  await ensureStorageDirectory();
  await FileSystem.writeAsStringAsync(
    TRIPS_FILE_PATH,
    JSON.stringify(trips, null, 2),
  );
}
