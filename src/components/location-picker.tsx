import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import {
    Platform,
    Pressable,
    ScrollView,
    StyleSheet,
    Switch,
    TextInput,
    View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import {
    readTripsFromFile,
    sortTripsByStartDate,
    writeTripsToFile,
} from "@/components/plannerStorage";
import type { Segment } from "@/components/plannerTypes";
import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { BottomTabInset, MaxContentWidth, Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { DEFAULT_LOCALE, t } from "@/i18n";
import {
    readSavedLocations,
    removeSavedLocation,
    upsertSavedLocation,
    type SavedLocation,
} from "./locationLibraryStorage";

type LocationResult = {
  place_id: string;
  display_name: string;
  lat: string;
  lon: string;
  boundingbox: string[];
  type?: string;
  class?: string;
  address?: Record<string, string>;
};

const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";
const OPENROUTESERVICE_API_KEY =
  process.env.OPENROUTESERVICE_API_KEY ??
  "eyJvcmciOiI1YjNjZTM1OTc4NTExMTAwMDFjZjYyNDgiLCJpZCI6IjdhZTFlYzBlNTEzZDQ5ZjQ5Zjg1NDFhNzM1NDIyZDhjIiwiaCI6Im11cm11cjY0In0=";
const OPENROUTESERVICE_URL = "https://api.openrouteservice.org/v2/directions";
const AI_ROUTE_PROXY_URL =
  process.env.EXPO_PUBLIC_AI_ROUTE_PROXY_URL ?? "/api/route-poi";

async function extractChatGptTextFromLink(
  rawValue: string,
): Promise<string | null> {
  const trimmed = rawValue.trim();
  if (!trimmed) {
    return null;
  }

  const isLikelyChatUrl =
    /chatgpt\.com\/(share|c)|chat\.openai\.com\/(share|c)/i.test(trimmed);
  if (!isLikelyChatUrl) {
    return null;
  }

  try {
    const response = await fetch(trimmed, {
      method: "GET",
      headers: {
        Accept: "text/html,application/xhtml+xml",
      },
    });

    if (!response.ok) {
      console.warn("[ChatLink] Could not fetch shared chat URL", {
        status: response.status,
      });
      return null;
    }

    const html = await response.text();
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, "text/html");
    const textNodes = Array.from(
      doc.querySelectorAll("article, p, li, pre, code, div, section"),
    )
      .map((node) => node.textContent ?? "")
      .map((text) => text.replace(/\s+/g, " ").trim())
      .filter(Boolean);

    const cleaned = textNodes.filter((text) => text.length > 20).join(" \n\n");

    return cleaned || null;
  } catch (error) {
    console.warn("[ChatLink] Failed to parse shared-chat link", error);
    return null;
  }
}

type RouteService = "osrm" | "ors";
type TravelMode = "car" | "walking" | "plane" | "ferry";
type LocationSource = "search" | "saved";

const ROUTE_SERVICES: { key: RouteService; label: string }[] = [
  { key: "osrm", label: "OSRM" },
  { key: "ors", label: "OpenRouteService" },
];

const TRAVEL_MODES: {
  key: TravelMode;
  label: string;
  osrm: string;
  ors: string;
}[] = [
  {
    key: "car",
    label: t("planner.routeModeCar", DEFAULT_LOCALE, "Car"),
    osrm: "driving",
    ors: "driving-car",
  },
  {
    key: "walking",
    label: t("planner.routeModeWalking", DEFAULT_LOCALE, "Walking"),
    osrm: "walking",
    ors: "foot-walking",
  },
  {
    key: "plane",
    label: t("planner.routeModePlane", DEFAULT_LOCALE, "Plane"),
    osrm: "driving",
    ors: "driving-car",
  },
  {
    key: "ferry",
    label: t("planner.routeModeFerry", DEFAULT_LOCALE, "Ferry"),
    osrm: "driving",
    ors: "driving-car",
  },
];

type LocationPickerProps = {
  backgroundMap?: boolean;
};

function timeToMinutes(value: string) {
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

function minutesToTime(totalMinutes: number) {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function roundUpToQuarterHour(totalMinutes: number) {
  return Math.max(15, Math.ceil(totalMinutes / 15) * 15);
}

function compactLocationLabel(value: string) {
  if (!value) return value;

  const parts = value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);

  if (parts.length <= 1) {
    return parts[0] ?? value;
  }

  return `${parts[0]}, ${parts[1]}`;
}

function primaryLocationLabel(location: LocationResult) {
  return compactLocationLabel(location.display_name);
}

function toSavedLocation(
  location: LocationResult,
): Omit<SavedLocation, "savedAt"> {
  return {
    place_id: location.place_id,
    display_name: location.display_name,
    lat: location.lat,
    lon: location.lon,
    type: location.type,
    class: location.class,
  };
}

function toLocationResult(location: SavedLocation): LocationResult {
  return {
    place_id: location.place_id,
    display_name: location.display_name,
    lat: location.lat,
    lon: location.lon,
    boundingbox: [],
    type: location.type,
    class: location.class,
    address: undefined,
  };
}

function buildPlaneRouteGeometry(
  startLon: number,
  startLat: number,
  endLon: number,
  endLat: number,
  segments = 24,
): Array<[number, number]> {
  const start: [number, number] = [startLon, startLat];
  const end: [number, number] = [endLon, endLat];

  const toMercatorX = (lon: number) => (lon * Math.PI) / 180;
  const toMercatorY = (lat: number) =>
    Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
  const fromMercatorX = (x: number) => (x * 180) / Math.PI;
  const fromMercatorY = (y: number) =>
    ((2 * Math.atan(Math.exp(y)) - Math.PI / 2) * 180) / Math.PI;

  const startMercator = {
    x: toMercatorX(start[0]),
    y: toMercatorY(start[1]),
  };
  const endMercator = {
    x: toMercatorX(end[0]),
    y: toMercatorY(end[1]),
  };

  const dx = endMercator.x - startMercator.x;
  const dy = endMercator.y - startMercator.y;
  const distance = Math.hypot(dx, dy) || 1;
  const perpendicularX = -dy / distance;
  const perpendicularY = dx / distance;
  const curvature = Math.min(0.18, Math.max(0.08, distance / 18000000));
  const control = {
    x:
      (startMercator.x + endMercator.x) / 2 +
      perpendicularX * distance * curvature,
    y:
      (startMercator.y + endMercator.y) / 2 +
      perpendicularY * distance * curvature,
  };

  const points: Array<[number, number]> = [];
  for (let index = 0; index <= segments; index += 1) {
    const t = index / segments;
    const x =
      (1 - t) * (1 - t) * startMercator.x +
      2 * (1 - t) * t * control.x +
      t * t * endMercator.x;
    const y =
      (1 - t) * (1 - t) * startMercator.y +
      2 * (1 - t) * t * control.y +
      t * t * endMercator.y;

    points.push([fromMercatorX(x), fromMercatorY(y)]);
  }

  return points;
}

function buildLocalRouteMapDataUrl(
  startLat: number,
  startLon: number,
  endLat: number,
  endLon: number,
  _routeCoordinates?: Array<[number, number]> | null,
  _renderRouteLine = true,
) {
  const latValues = [startLat, endLat];
  const lonValues = [startLon, endLon];
  const centerLat = (Math.min(...latValues) + Math.max(...latValues)) / 2;
  const centerLon = (Math.min(...lonValues) + Math.max(...lonValues)) / 2;
  const latSpan = Math.max(Math.abs(startLat - endLat), 0.15);
  const lonSpan = Math.max(Math.abs(startLon - endLon), 0.15);
  const zoom = Math.max(
    4,
    Math.min(
      12,
      Math.round(10 - Math.log2(Math.max(latSpan, lonSpan) * 6 + 1)),
    ),
  );
  const markers = [
    `${startLat},${startLon},green`,
    `${endLat},${endLon},orange`,
  ].join("|");

  return `https://staticmap.openstreetmap.de/staticmap.php?center=${centerLat},${centerLon}&zoom=${zoom}&size=1000x300&maptype=mapnik&markers=${markers}`;
}

const EXPERIMENTAL_POI_PROMPT =
  "Kérlek, foglald össze magyarul ezt az útvonalat egyetlen, jól olvasható, élvezetes, hosszabb utazási leírásban, útvonaljellegű összefoglalóként. A válaszban csak magyarul írj, és emeld ki a látnivalókat, érdekességeket, különleges helyeket és a program logikáját. Ne használj listákat, ne markdownot, és ne rövid válaszokat. Az útvonal: Bergenben a következő útvonalat tervezem: ByGarasjen -> Det Lille Kaffekompaniet (kávé, süti, valami igazi norvég édesség) -> Fløibanen -> Floyen Panorama és rövid séta -> vissza a Fløibanen -> Bryggen, kalandozások a kis utcákban -> St Mary's Church | Bergen -> Bergenhus Fortress -> Baker Brun Svensgården -> Fishmarket in Bergen (megkóstolom a rekken-t) -> KIWI Strømgaten (bevásárlás vacsorára, illetve másnapra reggelinek, szendvicsnek az útra és vacsorának estére, valamint reggelire a következő napra. Majd vissza a ByGarasjean-hez. Összefoglalnád ezt egy útvonalként, kiemelve a látnivalókat, érdekességeket, stb? Nem baj, ha hosszú lesz.";

function buildLocalRoutePoiHint(
  originName: string,
  destinationName: string,
  travelMode: TravelMode,
  distanceKm: number,
  durationMinutes: number,
): string {
  const modeLabel =
    travelMode === "walking"
      ? "walk"
      : travelMode === "plane"
        ? "fly"
        : travelMode === "ferry"
          ? "take a ferry"
          : "drive";
  const landmarkHints = [
    "a prominent church tower",
    "a scenic lookout point",
    "a well-known café or station",
    "a large public square",
    "a distinctive landmark visible from the road",
  ];
  const hint =
    landmarkHints[
      Math.abs(Math.floor(distanceKm * 10) + originName.length) %
        landmarkHints.length
    ];

  return `On the way from ${originName} to ${destinationName}, keep an eye out for ${hint} while you ${modeLabel} roughly ${distanceKm.toFixed(1)} km in about ${Math.max(1, Math.round(durationMinutes || 15))} minutes.`;
}

async function generateRoutePoiHint(
  originName: string,
  destinationName: string,
  travelMode: TravelMode,
  distanceKm: number,
  durationMinutes: number,
): Promise<string | null> {
  try {
    const response = await fetch(AI_ROUTE_PROXY_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        prompt: EXPERIMENTAL_POI_PROMPT,
      }),
    });

    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      console.warn("[RoutePOI] AI request failed", {
        status: response.status,
        payload,
      });
      return null;
    }

    const clean =
      typeof payload?.answer === "string" ? payload.answer.trim() : "";
    return clean.length > 0 ? clean : null;
  } catch (error) {
    console.warn("[RoutePOI] AI request error", error);
    return null;
  }
}

export function LocationPicker({ backgroundMap = false }: LocationPickerProps) {
  const router = useRouter();
  const params = useLocalSearchParams<{
    tripId?: string;
    day?: string;
    segmentId?: string;
  }>();
  const theme = useTheme();
  const searchInputRef = useRef<TextInput>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<LocationResult[]>([]);
  const [selected, setSelected] = useState<LocationResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);
  const [routeStops, setRouteStops] = useState<LocationResult[]>([]);
  const [routeInfo, setRouteInfo] = useState<{
    distance: number;
    duration: number;
    geometry: any;
  } | null>(null);
  const [routeLoading, setRouteLoading] = useState(false);
  const [routeMessage, setRouteMessage] = useState<string | null>(null);
  const [routeService, setRouteService] = useState<RouteService>("osrm");
  const [travelMode, setTravelMode] = useState<TravelMode>("car");
  const [routeSaveLoading, setRouteSaveLoading] = useState(false);
  const [routePoiLoading, setRoutePoiLoading] = useState(false);
  const [chatLinkExtractLoading, setChatLinkExtractLoading] = useState(false);
  const [singleLocationActivity, setSingleLocationActivity] = useState(false);
  const [activityDescription, setActivityDescription] = useState("");
  const [activityDurationMinutes, setActivityDurationMinutes] = useState("60");
  const [activityMoreDetails, setActivityMoreDetails] = useState("");
  const [routeDistanceKm, setRouteDistanceKm] = useState("");
  const [routeTravelMinutes, setRouteTravelMinutes] = useState("");
  const [activitySaveLoading, setActivitySaveLoading] = useState(false);
  const [locationSource, setLocationSource] =
    useState<LocationSource>("search");
  const [savedLocations, setSavedLocations] = useState<SavedLocation[]>([]);
  const [activeResultPlaceId, setActiveResultPlaceId] = useState<string | null>(
    null,
  );

  const mapContainerRef = useRef<any>(null);
  const mapRef = useRef<any>(null);
  const maplibreglRef = useRef<any>(null);

  const isWeb = Platform.OS === "web";
  const activeTripId =
    typeof params.tripId === "string" ? params.tripId : undefined;
  const activeDay = typeof params.day === "string" ? params.day : undefined;
  const editingSegmentId =
    typeof params.segmentId === "string" ? params.segmentId : null;

  const hydrateFromSegment = async (segment: Segment) => {
    setSingleLocationActivity(segment.locationMode === "single");
    setActivityDescription(segment.activityDescription ?? "");
    setActivityMoreDetails(segment.details ?? "");
    setRouteDistanceKm(
      typeof segment.routeDistanceKm === "number"
        ? String(segment.routeDistanceKm)
        : "",
    );
    setRouteTravelMinutes(
      typeof segment.routeTravelMinutes === "number"
        ? String(segment.routeTravelMinutes)
        : "",
    );
    setTravelMode(segment.commuteType ?? "car");

    if (segment.locationMode === "single") {
      const location = segment.location?.trim();
      const lat = segment.locationLat;
      const lon = segment.locationLon;
      setSelected(
        location && Number.isFinite(lat) && Number.isFinite(lon)
          ? {
              place_id: segment.id,
              display_name: location,
              lat: String(lat),
              lon: String(lon),
              boundingbox: [],
            }
          : null,
      );
      setRouteStops([]);
      setActivityDurationMinutes(
        String(
          Math.max(
            15,
            Math.round(
              (timeToMinutes(segment.endTime) -
                timeToMinutes(segment.startTime)) /
                15,
            ) * 15,
          ),
        ),
      );
      return;
    }

    const routeStopsFromSegment =
      Array.isArray(segment.routeStops) && segment.routeStops.length > 0
        ? segment.routeStops.map((stop) => ({
            place_id: `${segment.id}-${stop.display_name}`,
            display_name: stop.display_name,
            lat: String(stop.lat),
            lon: String(stop.lon),
            boundingbox: [],
          }))
        : [];

    if (routeStopsFromSegment.length === 0) {
      const startLocation = segment.startLocation?.trim();
      const endLocation = segment.endLocation?.trim();
      const startLat = Number(segment.startLocationLat);
      const startLon = Number(segment.startLocationLon);
      const endLat = Number(segment.endLocationLat);
      const endLon = Number(segment.endLocationLon);

      if (
        startLocation &&
        endLocation &&
        Number.isFinite(startLat) &&
        Number.isFinite(startLon) &&
        Number.isFinite(endLat) &&
        Number.isFinite(endLon)
      ) {
        setRouteStops([
          {
            place_id: `${segment.id}-start`,
            display_name: startLocation,
            lat: String(startLat),
            lon: String(startLon),
            boundingbox: [],
          },
          {
            place_id: `${segment.id}-end`,
            display_name: endLocation,
            lat: String(endLat),
            lon: String(endLon),
            boundingbox: [],
          },
        ]);
      } else {
        setRouteStops([]);
      }
    } else {
      setRouteStops(routeStopsFromSegment);
    }

    setSelected(null);
    setActivityDurationMinutes("60");
    setRouteMessage(null);
    setRouteInfo(null);
  };

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!selected) {
      return;
    }

    setActivityDescription((current) =>
      current.trim() ? current : `Visit ${primaryLocationLabel(selected)}`,
    );
  }, [selected]);

  useEffect(() => {
    if (!activeTripId) {
      setSavedLocations([]);
      return;
    }

    void (async () => {
      const locations = await readSavedLocations(activeTripId);
      setSavedLocations(locations);
    })();
  }, [activeTripId]);
  /* eslint-enable react-hooks/set-state-in-effect */

  useEffect(() => {
    if (!activeTripId || !activeDay || !editingSegmentId) {
      return;
    }

    void (async () => {
      const trips = await readTripsFromFile();
      const targetTrip = trips.find((trip) => trip.id === activeTripId);
      const dayPlan = targetTrip?.days?.[activeDay];
      const segment = [
        ...(dayPlan?.segments ?? []),
        ...(dayPlan?.availableSegments ?? []),
      ].find((candidate) => candidate.id === editingSegmentId);

      if (!segment) {
        return;
      }

      await hydrateFromSegment(segment);
    })();
  }, [activeDay, activeTripId, editingSegmentId]);

  const persistLocation = async (location: LocationResult) => {
    if (!activeTripId) {
      setMessage("Open Location Lookup from a trip day to save locations.");
      return;
    }

    const updated = await upsertSavedLocation(
      activeTripId,
      toSavedLocation(location),
    );
    setSavedLocations(updated);
  };

  const routeOrigin = routeStops[0] ?? null;
  const routeDestination = routeStops[routeStops.length - 1] ?? null;
  const routeIntermediateStops = routeStops.slice(1, -1);

  const addRouteStop = (location: LocationResult) => {
    setRouteStops((current) => {
      if (current.some((stop) => stop.place_id === location.place_id)) {
        return current;
      }
      return [...current, location];
    });
    setRouteInfo(null);
    setRouteMessage(null);
  };

  const moveRouteStop = (index: number, direction: -1 | 1) => {
    setRouteStops((current) => {
      const nextIndex = index + direction;
      if (nextIndex < 0 || nextIndex >= current.length) {
        return current;
      }
      const updated = [...current];
      [updated[index], updated[nextIndex]] = [
        updated[nextIndex],
        updated[index],
      ];
      return updated;
    });
  };

  const removeRouteStop = (index: number) => {
    setRouteStops((current) =>
      current.filter((_, currentIndex) => currentIndex !== index),
    );
    setRouteInfo(null);
  };

  const handleLocationSelection = async (location: LocationResult) => {
    setActiveResultPlaceId(location.place_id);
    setMessage(null);
    setRouteMessage(null);

    const shouldPersistLocation = locationSource === "search";

    if (singleLocationActivity) {
      setSelected(location);
      if (shouldPersistLocation) {
        await persistLocation(location);
      }
      setQuery("");
      setResults([]);
      searchInputRef.current?.focus();
      return;
    }

    addRouteStop(location);
    if (shouldPersistLocation) {
      await persistLocation(location);
    }
    setQuery("");
    setResults([]);
    searchInputRef.current?.focus();
  };

  const handleRemoveSavedLocation = async (location: LocationResult) => {
    if (!activeTripId) {
      return;
    }

    const updated = await removeSavedLocation(activeTripId, location.place_id);
    setSavedLocations(updated);

    if (selected?.place_id === location.place_id) {
      setSelected(null);
    }
    if (routeStops.some((stop) => stop.place_id === location.place_id)) {
      setRouteStops((current) =>
        current.filter((stop) => stop.place_id !== location.place_id),
      );
      setRouteInfo(null);
    }
  };

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (singleLocationActivity || routeStops.length < 2) {
      return;
    }

    if (travelMode === "plane" || travelMode === "ferry") {
      const origin = routeStops[0];
      const destination = routeStops[routeStops.length - 1];
      if (!origin || !destination) {
        setRouteInfo(null);
        return;
      }

      setRouteInfo({
        distance: 0,
        duration: 0,
        geometry: {
          type: "LineString",
          coordinates: buildPlaneRouteGeometry(
            Number(origin.lon),
            Number(origin.lat),
            Number(destination.lon),
            Number(destination.lat),
          ),
        },
      });
      setRouteMessage(
        travelMode === "plane"
          ? "Plane travel is shown as a direct flight arc; enter the travel time manually."
          : "Ferry travel is shown as a direct route arc; enter the travel time manually.",
      );
      return;
    }

    void calculateRoute(travelMode);
  }, [singleLocationActivity, routeStops, travelMode]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const lookupLocation = async () => {
    const queryText = query.trim();
    if (!queryText) {
      setMessage("Enter a place name, address, or city to validate.");
      setResults([]);
      setSelected(null);
      return;
    }

    setLoading(true);
    setMessage(null);
    setLocationSource("search");
    setActiveResultPlaceId(null);
    setResults([]);

    try {
      const url = `${NOMINATIM_URL}?format=json&addressdetails=1&limit=5&q=${encodeURIComponent(
        queryText,
      )}`;
      const response = await fetch(url, {
        headers: { Accept: "application/json" },
      });

      if (!response.ok) {
        throw new Error("Location service returned an error.");
      }

      const data = (await response.json()) as LocationResult[];
      if (!Array.isArray(data) || data.length === 0) {
        setMessage("No matching locations found. Try a different query.");
        return;
      }

      setResults(data.slice(0, 5));
    } catch (error) {
      setMessage("Could not verify this location. Please try another search.");
    } finally {
      setLoading(false);
    }
  };

  const captureMapSnapshot = async (): Promise<string | null> => {
    if (!isWeb || !mapRef.current) {
      return null;
    }

    const canvas = mapRef.current.getCanvas?.();
    if (!canvas) {
      return null;
    }

    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => resolve());
      });
    });

    try {
      const dataUrl = canvas.toDataURL("image/png");
      return dataUrl && dataUrl.length > 1000 ? dataUrl : null;
    } catch {
      return null;
    }
  };

  async function calculateRoute(travelModeOverride?: TravelMode) {
    if (routeStops.length < 2) return;

    const activeTravelMode = travelModeOverride ?? travelMode;
    if (activeTravelMode === "plane" || activeTravelMode === "ferry") {
      const origin = routeStops[0];
      const destination = routeStops[routeStops.length - 1];
      if (!origin || !destination) {
        setRouteInfo(null);
        setRouteMessage(
          activeTravelMode === "plane"
            ? "Plane travel uses the two locations only; enter the travel time manually."
            : "Ferry travel uses the two locations only; enter the travel time manually.",
        );
        return;
      }

      setRouteInfo({
        distance: 0,
        duration: 0,
        geometry: {
          type: "LineString",
          coordinates: buildPlaneRouteGeometry(
            Number(origin.lon),
            Number(origin.lat),
            Number(destination.lon),
            Number(destination.lat),
          ),
        },
      });
      setRouteMessage(
        activeTravelMode === "plane"
          ? "Plane travel is shown as a direct flight arc; enter the travel time manually."
          : "Ferry travel is shown as a direct route arc; enter the travel time manually.",
      );
      setRouteLoading(false);
      return;
    }

    setRouteLoading(true);
    setRouteMessage(null);
    setRouteInfo(null);

    const routeOption = TRAVEL_MODES.find(
      (option) => option.key === activeTravelMode,
    );
    const routeMode =
      routeService === "ors" ? routeOption?.ors : routeOption?.osrm;
    if (!routeMode) {
      setRouteMessage("Selected travel mode is not supported.");
      setRouteLoading(false);
      return;
    }

    try {
      const routeCoordinates = routeStops.map((stop) => [
        Number(stop.lon),
        Number(stop.lat),
      ]) as [number, number][];
      const waypointCoords = routeStops
        .map((stop) => `${Number(stop.lon)},${Number(stop.lat)}`)
        .join(";");

      if (routeService === "ors") {
        const url = `${OPENROUTESERVICE_URL}/${routeMode}/geojson`;
        const response = await fetch(url, {
          method: "POST",
          headers: {
            Authorization: OPENROUTESERVICE_API_KEY,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            coordinates: routeCoordinates,
          }),
        });

        if (!response.ok) {
          const body = await response.text();
          throw new Error(`Route service returned an error: ${body}`);
        }

        const data = await response.json();
        const routeFeature = data?.features?.[0];
        const geometry = routeFeature?.geometry;
        const summary = routeFeature?.properties?.summary;

        if (!geometry || geometry.type !== "LineString") {
          throw new Error("Invalid route geometry.");
        }

        setRouteInfo({
          distance: summary?.distance ?? 0,
          duration: summary?.duration ?? 0,
          geometry,
        });
        setRouteDistanceKm(((summary?.distance ?? 0) / 1000).toFixed(1));
        setRouteTravelMinutes(
          String(Math.max(1, Math.round((summary?.duration ?? 0) / 60))),
        );
      } else {
        const url = `https://router.project-osrm.org/route/v1/${routeMode}/${waypointCoords}?overview=full&geometries=geojson&steps=false`;
        const response = await fetch(url);
        if (!response.ok) throw new Error("Route service returned an error.");

        const data = await response.json();
        if (
          data.code !== "Ok" ||
          !Array.isArray(data.routes) ||
          data.routes.length === 0
        ) {
          throw new Error("No route was found for these locations.");
        }

        const route = data.routes[0];
        if (!route.geometry || route.geometry.type !== "LineString") {
          throw new Error("Invalid route geometry.");
        }

        setRouteInfo({
          distance: route.distance ?? 0,
          duration: route.duration ?? 0,
          geometry: route.geometry,
        });
        setRouteDistanceKm(((route.distance ?? 0) / 1000).toFixed(1));
        setRouteTravelMinutes(
          String(Math.max(1, Math.round((route.duration ?? 0) / 60))),
        );
      }
    } catch (e) {
      setRouteMessage("Unable to calculate a path for the selected stops.");
    } finally {
      setRouteLoading(false);
    }
  }

  const generateRoutePoiSuggestion = async () => {
    if (!routeOrigin || !routeDestination) {
      return;
    }

    const distanceKm = Number(routeDistanceKm) || 0;
    const durationMinutes = Number(routeTravelMinutes) || 0;

    setRoutePoiLoading(true);
    setRouteMessage(null);

    try {
      const hint = await generateRoutePoiHint(
        routeOrigin.display_name,
        routeDestination.display_name,
        travelMode,
        distanceKm,
        durationMinutes,
      );

      if (!hint) {
        console.error("[RoutePOI] No AI result returned for route hint.");
        setRouteMessage("AI route hint is currently unavailable.");
        return;
      }

      setActivityMoreDetails(hint);
      setRouteMessage(null);
    } finally {
      setRoutePoiLoading(false);
    }
  };

  const handleImportChatDetails = async () => {
    const trimmed = activityMoreDetails.trim();
    if (!trimmed) {
      return;
    }

    setChatLinkExtractLoading(true);
    try {
      const extracted = await extractChatGptTextFromLink(trimmed);
      if (extracted) {
        setActivityMoreDetails(extracted);
      } else {
        setRouteMessage(
          "This does not look like a public ChatGPT share link or the chat is not readable from the URL.",
        );
      }
    } finally {
      setChatLinkExtractLoading(false);
    }
  };

  const saveRouteSegment = async () => {
    if (!routeOrigin || !routeDestination || !activeTripId || !activeDay) {
      return;
    }

    const trimmedDescription = activityDescription.trim();
    const trimmedDetails = activityMoreDetails.trim();
    const parsedDistanceKm = Number(routeDistanceKm);
    const parsedTravelMinutes = Number(routeTravelMinutes);
    const routeCoordinates =
      routeInfo?.geometry && routeInfo.geometry.type === "LineString"
        ? (routeInfo.geometry.coordinates as Array<[number, number]>)
        : undefined;
    const safeDistanceKm =
      travelMode === "plane"
        ? Number.isFinite(parsedDistanceKm) && parsedDistanceKm > 0
          ? parsedDistanceKm
          : undefined
        : Number.isFinite(parsedDistanceKm) && parsedDistanceKm > 0
          ? parsedDistanceKm
          : undefined;
    const generatedRouteMapUrl = buildLocalRouteMapDataUrl(
      Number(routeOrigin.lat),
      Number(routeOrigin.lon),
      Number(routeDestination.lat),
      Number(routeDestination.lon),
      routeCoordinates,
      travelMode !== "plane",
    );
    const snapshotMapUrl = await captureMapSnapshot();
    const routeMapUrl =
      snapshotMapUrl && !snapshotMapUrl.startsWith("data:image/png;base64")
        ? snapshotMapUrl
        : generatedRouteMapUrl;

    if (!trimmedDescription) {
      setRouteMessage("Add an activity name before saving the route segment.");
      return;
    }

    if (
      travelMode !== "plane" &&
      travelMode !== "ferry" &&
      (!Number.isFinite(parsedDistanceKm) || parsedDistanceKm <= 0)
    ) {
      setRouteMessage("Enter a valid distance in kilometers.");
      return;
    }

    if (!Number.isFinite(parsedTravelMinutes) || parsedTravelMinutes <= 0) {
      setRouteMessage("Enter a valid travel time in minutes.");
      return;
    }

    setRouteSaveLoading(true);
    setRouteMessage(null);

    try {
      const trips = await readTripsFromFile();
      const targetTrip = trips.find((trip) => trip.id === activeTripId);

      if (!targetTrip) {
        throw new Error("Trip not found.");
      }

      const durationMinutes = roundUpToQuarterHour(parsedTravelMinutes);
      const routeSegment: Segment = {
        id:
          editingSegmentId ??
          `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        startTime: "00:00",
        endTime: minutesToTime(durationMinutes),
        activityDescription: trimmedDescription,
        locationMode: "route",
        startLocation: routeOrigin.display_name,
        startLocationLat: Number(routeOrigin.lat),
        startLocationLon: Number(routeOrigin.lon),
        endLocation: routeDestination.display_name,
        endLocationLat: Number(routeDestination.lat),
        endLocationLon: Number(routeDestination.lon),
        routeStops: routeStops.map((stop) => ({
          display_name: stop.display_name,
          lat: Number(stop.lat),
          lon: Number(stop.lon),
        })),
        commuteType: travelMode,
        routeDistanceKm: safeDistanceKm,
        routeTravelMinutes: parsedTravelMinutes,
        routeMapUrl,
      };

      if (trimmedDetails) {
        routeSegment.details = trimmedDetails;
      }

      const dayPlan = targetTrip.days?.[activeDay] ?? {
        segments: [],
        availableSegments: [],
      };
      const existingSegments = dayPlan.segments ?? [];
      const existingAvailableSegments = dayPlan.availableSegments ?? [];
      const nextSegments = editingSegmentId
        ? existingSegments.filter((segment) => segment.id !== editingSegmentId)
        : existingSegments;
      const nextAvailableSegments = editingSegmentId
        ? existingAvailableSegments.filter(
            (segment) => segment.id !== editingSegmentId,
          )
        : existingAvailableSegments;

      const updatedTrips = trips.map((trip) =>
        trip.id !== activeTripId
          ? trip
          : {
              ...trip,
              days: {
                ...(trip.days ?? {}),
                [activeDay]: {
                  segments: nextSegments,
                  availableSegments: [...nextAvailableSegments, routeSegment],
                },
              },
            },
      );

      await writeTripsToFile(sortTripsByStartDate(updatedTrips));
      router.push("/");
    } catch {
      setRouteMessage(
        "The route was calculated, but the segment could not be saved.",
      );
    } finally {
      setRouteSaveLoading(false);
    }
  };

  const saveSingleLocationSegment = async () => {
    if (!selected || !activeTripId || !activeDay) {
      return;
    }

    const trimmedDescription = activityDescription.trim();
    const trimmedDetails = activityMoreDetails.trim();
    const parsedDuration = Number(activityDurationMinutes);

    if (!trimmedDescription) {
      setMessage("Add an activity description before saving the activity.");
      return;
    }

    if (!Number.isFinite(parsedDuration) || parsedDuration <= 0) {
      setMessage("Enter the activity duration in minutes.");
      return;
    }

    setActivitySaveLoading(true);
    setMessage(null);

    try {
      const trips = await readTripsFromFile();
      const targetTrip = trips.find((trip) => trip.id === activeTripId);

      if (!targetTrip) {
        throw new Error("Trip not found.");
      }

      const durationMinutes = roundUpToQuarterHour(parsedDuration);
      const activitySegment: Segment = {
        id:
          editingSegmentId ??
          `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        startTime: "00:00",
        endTime: minutesToTime(durationMinutes),
        activityDescription: trimmedDescription,
        locationMode: "single",
        location: selected.display_name,
        locationLat: Number(selected.lat),
        locationLon: Number(selected.lon),
      };

      if (trimmedDetails) {
        activitySegment.details = trimmedDetails;
      }

      const dayPlan = targetTrip.days?.[activeDay] ?? {
        segments: [],
        availableSegments: [],
      };
      const existingSegments = dayPlan.segments ?? [];
      const existingAvailableSegments = dayPlan.availableSegments ?? [];
      const nextSegments = editingSegmentId
        ? existingSegments.filter((segment) => segment.id !== editingSegmentId)
        : existingSegments;
      const nextAvailableSegments = editingSegmentId
        ? existingAvailableSegments.filter(
            (segment) => segment.id !== editingSegmentId,
          )
        : existingAvailableSegments;

      const updatedTrips = trips.map((trip) =>
        trip.id !== activeTripId
          ? trip
          : {
              ...trip,
              days: {
                ...(trip.days ?? {}),
                [activeDay]: {
                  segments: nextSegments,
                  availableSegments: [
                    ...nextAvailableSegments,
                    activitySegment,
                  ],
                },
              },
            },
      );

      await writeTripsToFile(sortTripsByStartDate(updatedTrips));
      router.push("/");
    } catch {
      setMessage(
        "The location was selected, but the activity segment could not be saved.",
      );
    } finally {
      setActivitySaveLoading(false);
    }
  };

  useEffect(() => {
    if (!isWeb || mapRef.current) return;
    let cancelled = false;

    const init = async () => {
      if (!mapContainerRef.current) return;
      const pkg = await import("maplibre-gl");
      const maplibregl = pkg.default ?? pkg;
      maplibreglRef.current = maplibregl;

      const map = new maplibregl.Map({
        container: mapContainerRef.current,
        style: "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json",
        center: [10, 50],
        zoom: 4,
        minZoom: 2,
        maxZoom: 16,
        attributionControl: { compact: true },
      });

      map.on("load", () => {
        if (cancelled) return;

        map.addControl(
          new maplibregl.NavigationControl({ visualizePitch: false }),
          "top-right",
        );
        map.addControl(
          new maplibregl.ScaleControl({ maxWidth: 100, unit: "metric" }),
          "bottom-right",
        );

        map.on("error", (evt: any) => {
          if (evt && evt.error)
            setMapError("A map tile or style resource failed to load.");
        });

        if (!map.getSource("location-data")) {
          map.addSource("location-data", {
            type: "geojson",
            data: { type: "FeatureCollection", features: [] },
          });
        }

        // layers
        if (!map.getLayer("route-line")) {
          map.addLayer({
            id: "route-line",
            type: "line",
            source: "location-data",
            filter: ["==", ["get", "featureType"], "route"],
            paint: {
              "line-color": "#0b74de",
              "line-width": 5,
              "line-opacity": 0.9,
            },
          });
        }

        if (!map.getLayer("pinned-locations")) {
          map.addLayer({
            id: "pinned-locations",
            type: "circle",
            source: "location-data",
            filter: ["==", ["get", "featureType"], "pinned"],
            paint: {
              "circle-radius": 8,
              "circle-color": "#ff6f00",
              "circle-stroke-color": "#ffffff",
              "circle-stroke-width": 2,
            },
          });
        }

        if (!map.getLayer("selected-location")) {
          map.addLayer({
            id: "selected-location",
            type: "circle",
            source: "location-data",
            filter: ["==", ["get", "featureType"], "selected"],
            paint: {
              "circle-radius": 10,
              "circle-color": "#0b74de",
              "circle-stroke-color": "#ffffff",
              "circle-stroke-width": 2,
            },
          });
        }

        if (!map.getLayer("route-endpoints")) {
          map.addLayer({
            id: "route-endpoints",
            type: "circle",
            source: "location-data",
            filter: ["==", ["get", "featureType"], "routeEndpoint"],
            paint: {
              "circle-radius": 10,
              "circle-color": [
                "match",
                ["get", "endpointType"],
                "origin",
                "#16a34a",
                "destination",
                "#c2410c",
                "#000000",
              ],
              "circle-stroke-color": "#ffffff",
              "circle-stroke-width": 2,
            },
          });
        }

        mapRef.current = map;
        setMapReady(true);
      });
    };

    init();

    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, [isWeb]);

  useEffect(() => {
    if (!isWeb) return;
    const map = mapRef.current;
    if (!map || !map.getSource("location-data")) return;

    const pointFeatures: any[] = [];

    if (selected) {
      const lon = Number(selected.lon);
      const lat = Number(selected.lat);
      if (Number.isFinite(lon) && Number.isFinite(lat)) {
        pointFeatures.push({
          type: "Feature",
          geometry: { type: "Point", coordinates: [lon, lat] },
          properties: { featureType: "selected", title: selected.display_name },
        });
      }
    }

    const routeFeatures: any[] = [];
    routeStops.forEach((stop, index) => {
      const lon = Number(stop.lon);
      const lat = Number(stop.lat);
      if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
        return;
      }

      const endpointType =
        index === 0
          ? "origin"
          : index === routeStops.length - 1
            ? "destination"
            : "intermediate";

      routeFeatures.push({
        type: "Feature",
        geometry: { type: "Point", coordinates: [lon, lat] },
        properties: {
          featureType: "routeEndpoint",
          endpointType,
          title: stop.display_name,
        },
      });
    });

    const features = [...pointFeatures, ...routeFeatures];

    if (routeInfo) {
      features.push({
        type: "Feature",
        geometry: routeInfo.geometry,
        properties: { featureType: "route" },
      });
    }

    (map.getSource("location-data") as any).setData({
      type: "FeatureCollection",
      features,
    });

    if (features.length > 0) {
      const firstCoords = features[0].geometry.coordinates;
      const bounds = features.reduce(
        (acc: any, feature: any) => {
          if (feature.geometry.type === "Point")
            acc.extend(feature.geometry.coordinates as [number, number]);
          if (feature.geometry.type === "LineString")
            feature.geometry.coordinates.forEach((c: [number, number]) =>
              acc.extend(c),
            );
          return acc;
        },
        new maplibreglRef.current.LngLatBounds(firstCoords, firstCoords),
      );

      if (routeInfo || routeStops.length >= 2) {
        map.fitBounds(bounds, { padding: 60, maxZoom: 12, linear: true });
      } else if (selected) {
        const last = features[features.length - 1].geometry.coordinates as [
          number,
          number,
        ];
        map.flyTo({ center: [last[0], last[1]], zoom: 12, essential: true });
      }
    }
  }, [selected, routeStops, routeInfo, isWeb]);

  const trimmedActivityName = activityDescription.trim();
  const trimmedMoreDetails = activityMoreDetails.trim();
  const hasActivityDuration =
    Number.isFinite(Number(activityDurationMinutes)) &&
    Number(activityDurationMinutes) > 0;
  const hasRouteDistanceKm =
    Number.isFinite(Number(routeDistanceKm)) && Number(routeDistanceKm) > 0;
  const hasRouteTravelMinutes =
    Number.isFinite(Number(routeTravelMinutes)) &&
    Number(routeTravelMinutes) > 0;

  const canShowSingleSaveButton =
    singleLocationActivity &&
    Boolean(activeTripId && activeDay) &&
    Boolean(selected) &&
    Boolean(trimmedActivityName) &&
    hasActivityDuration;

  const canShowRouteSaveButton =
    !singleLocationActivity &&
    Boolean(activeTripId && activeDay) &&
    Boolean(routeOrigin && routeDestination) &&
    Boolean(trimmedActivityName);

  const displayedLocations =
    locationSource === "saved"
      ? savedLocations.map((location) => toLocationResult(location))
      : results;

  const searchFieldLabel = singleLocationActivity
    ? "Find location"
    : routeOrigin && !routeDestination
      ? "Find destination"
      : "Find origin";

  return (
    <ThemedView
      style={backgroundMap ? styles.backgroundRoot : styles.container}
    >
      {isWeb && backgroundMap ? (
        <View ref={mapContainerRef} style={styles.backgroundMapContainer} />
      ) : null}

      {isWeb &&
      backgroundMap &&
      !singleLocationActivity &&
      routeStops.length > 0 ? (
        <View style={styles.routeStopsPanel} pointerEvents="box-none">
          <View style={styles.routeStopsPanelInner} pointerEvents="auto">
            <ThemedText type="smallBold">Route stops</ThemedText>
            {routeStops.map((stop, index) => (
              <View
                key={`${stop.place_id}-${index}`}
                style={styles.routeStopCard}
              >
                <View style={styles.routeStopHeader}>
                  <ThemedText type="smallBold" style={styles.routeStopNumber}>
                    {index + 1}
                  </ThemedText>
                  <ThemedText type="small" style={styles.routeStopName}>
                    {compactLocationLabel(stop.display_name)}
                  </ThemedText>
                </View>
                <View style={styles.routeStopActions}>
                  <Pressable
                    onPress={() => moveRouteStop(index, -1)}
                    disabled={index === 0}
                    style={({ pressed }) => [
                      styles.routeStopActionButton,
                      index === 0 && styles.routeStopActionDisabled,
                      pressed && styles.buttonPressed,
                    ]}
                  >
                    <ThemedText type="smallBold">↑</ThemedText>
                  </Pressable>
                  <Pressable
                    onPress={() => moveRouteStop(index, 1)}
                    disabled={index === routeStops.length - 1}
                    style={({ pressed }) => [
                      styles.routeStopActionButton,
                      index === routeStops.length - 1 &&
                        styles.routeStopActionDisabled,
                      pressed && styles.buttonPressed,
                    ]}
                  >
                    <ThemedText type="smallBold">↓</ThemedText>
                  </Pressable>
                  <Pressable
                    onPress={() => removeRouteStop(index)}
                    style={({ pressed }) => [
                      styles.routeStopActionButton,
                      pressed && styles.buttonPressed,
                    ]}
                  >
                    <ThemedText type="smallBold">Remove</ThemedText>
                  </Pressable>
                </View>
              </View>
            ))}
          </View>
        </View>
      ) : null}

      <SafeAreaView
        style={backgroundMap ? styles.backgroundSafeArea : styles.safeArea}
        pointerEvents="none"
      >
        <ThemedView
          style={[styles.card, backgroundMap && styles.overlayCard]}
          pointerEvents="box-none"
          onStartShouldSetResponder={() => false}
          onMoveShouldSetResponder={() => false}
        >
          <ScrollView
            style={styles.cardScrollView}
            contentContainerStyle={styles.cardContent}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            pointerEvents="auto"
          >
            <View style={styles.headerRow}>
              <ThemedText type="subtitle">
                {t("planner.locationLookup", DEFAULT_LOCALE, "Location lookup")}
              </ThemedText>
              <Pressable
                onPress={() => router.push("/")}
                style={({ pressed }) => [
                  styles.closeButton,
                  pressed && styles.buttonPressed,
                ]}
              >
                <ThemedText type="smallBold" style={styles.closeButtonText}>
                  X
                </ThemedText>
              </Pressable>
            </View>

            <View style={styles.modeToggleRow}>
              <ThemedText type="smallBold">
                {t(
                  "planner.singleLocationActivity",
                  DEFAULT_LOCALE,
                  "Single location activity",
                )}
              </ThemedText>
              <Switch
                value={singleLocationActivity}
                onValueChange={setSingleLocationActivity}
                trackColor={{ false: "#9ca3af", true: "#fb923c" }}
                thumbColor={singleLocationActivity ? "#ffffff" : "#f3f4f6"}
                ios_backgroundColor="#9ca3af"
              />
            </View>

            <View style={styles.formRow}>
              <View style={styles.searchFieldWrapper}>
                <ThemedText type="small" style={styles.searchLabel}>
                  {searchFieldLabel}
                </ThemedText>
                <TextInput
                  ref={searchInputRef}
                  value={query}
                  onChangeText={setQuery}
                  placeholder={t(
                    "planner.searchPlaceholder",
                    DEFAULT_LOCALE,
                    "Search a location",
                  )}
                  placeholderTextColor={theme.textSecondary}
                  onSubmitEditing={lookupLocation}
                  returnKeyType="search"
                  style={[
                    styles.input,
                    { backgroundColor: theme.background, color: theme.text },
                  ]}
                />
              </View>
              <Pressable
                onPress={lookupLocation}
                style={({ pressed }) => [
                  styles.button,
                  { backgroundColor: theme.backgroundElement },
                  pressed && styles.buttonPressed,
                ]}
              >
                <ThemedText type="smallBold">
                  {loading
                    ? t("planner.searching", DEFAULT_LOCALE, "Searching…")
                    : t("planner.search", DEFAULT_LOCALE, "Search")}
                </ThemedText>
              </Pressable>
            </View>

            <View style={styles.sourceToggleRow}>
              <Pressable
                onPress={() => {
                  setLocationSource("search");
                  setActiveResultPlaceId(null);
                }}
                style={({ pressed }) => [
                  styles.sourceToggleButton,
                  locationSource === "search" &&
                    styles.sourceToggleButtonActive,
                  pressed && styles.buttonPressed,
                ]}
              >
                <ThemedText
                  type="smallBold"
                  style={{
                    color: locationSource === "search" ? "#ffffff" : theme.text,
                  }}
                >
                  {t("planner.searchResults", DEFAULT_LOCALE, "Search results")}
                </ThemedText>
              </Pressable>
              <Pressable
                onPress={() => {
                  setLocationSource("saved");
                  setActiveResultPlaceId(null);
                }}
                style={({ pressed }) => [
                  styles.sourceToggleButton,
                  locationSource === "saved" && styles.sourceToggleButtonActive,
                  pressed && styles.buttonPressed,
                ]}
              >
                <ThemedText
                  type="smallBold"
                  style={{
                    color: locationSource === "saved" ? "#ffffff" : theme.text,
                  }}
                >
                  {t(
                    "planner.savedLocations",
                    DEFAULT_LOCALE,
                    "Saved locations",
                  )}
                </ThemedText>
              </Pressable>
            </View>

            {!activeTripId ? (
              <ThemedText
                type="small"
                themeColor="textSecondary"
                style={styles.message}
              >
                {t(
                  "planner.openTripDayHint",
                  DEFAULT_LOCALE,
                  "Saved locations are stored per trip. Open this page from a trip day to manage them.",
                )}
              </ThemedText>
            ) : null}

            {message ? (
              <ThemedText
                type="small"
                themeColor="textSecondary"
                style={styles.message}
              >
                {message}
              </ThemedText>
            ) : null}

            {displayedLocations.length > 0 ? (
              <View style={styles.resultsContainer}>
                <ThemedText type="smallBold">
                  {locationSource === "saved"
                    ? t(
                        "planner.pickSavedLocation",
                        DEFAULT_LOCALE,
                        "Pick a saved location",
                      )
                    : t(
                        "planner.bestMatch",
                        DEFAULT_LOCALE,
                        "Select the best match",
                      )}
                </ThemedText>
                {displayedLocations.map((result) => {
                  const isMarked = activeResultPlaceId === result.place_id;

                  return (
                    <View
                      key={result.place_id}
                      style={styles.resultItemWrapper}
                    >
                      <Pressable
                        onPress={() => void handleLocationSelection(result)}
                        style={({ pressed }) => [
                          styles.resultItem,
                          {
                            backgroundColor: theme.background,
                            borderColor: isMarked ? "#facc15" : "#e5e7eb",
                            borderWidth: isMarked ? 2 : 1,
                          },
                          pressed && styles.resultPressed,
                        ]}
                      >
                        <ThemedText type="smallBold">
                          {primaryLocationLabel(result)}
                        </ThemedText>
                        <ThemedText type="small" themeColor="textSecondary">
                          {compactLocationLabel(result.display_name)}
                        </ThemedText>
                      </Pressable>

                      <View style={styles.resultActionRow}>
                        {locationSource === "search" ? (
                          <Pressable
                            onPress={() => {
                              if (activeTripId) {
                                setLocationSource("saved");
                              }
                            }}
                            disabled={!activeTripId}
                            style={({ pressed }) => [
                              styles.actionButton,
                              {
                                backgroundColor: activeTripId
                                  ? theme.backgroundElement
                                  : theme.background,
                              },
                              pressed && styles.buttonPressed,
                            ]}
                          >
                            <ThemedText
                              type="small"
                              style={{ color: theme.text }}
                            >
                              {t(
                                "planner.showSavedLocations",
                                DEFAULT_LOCALE,
                                "Show saved locations",
                              )}
                            </ThemedText>
                          </Pressable>
                        ) : (
                          <>
                            <Pressable
                              onPress={() => {
                                setLocationSource("search");
                                setActiveResultPlaceId(null);
                              }}
                              style={({ pressed }) => [
                                styles.actionButton,
                                {
                                  backgroundColor: theme.backgroundElement,
                                },
                                pressed && styles.buttonPressed,
                              ]}
                            >
                              <ThemedText
                                type="small"
                                style={{ color: theme.text }}
                              >
                                {t(
                                  "planner.hideSwitchLocations",
                                  DEFAULT_LOCALE,
                                  "Hide switch locations",
                                )}
                              </ThemedText>
                            </Pressable>
                            <Pressable
                              onPress={() =>
                                void handleRemoveSavedLocation(result)
                              }
                              style={({ pressed }) => [
                                styles.actionButton,
                                styles.removeLocationButton,
                                pressed && styles.buttonPressed,
                              ]}
                            >
                              <ThemedText
                                type="small"
                                style={styles.removeLocationText}
                              >
                                {t("planner.remove", DEFAULT_LOCALE, "Remove")}
                              </ThemedText>
                            </Pressable>
                          </>
                        )}
                      </View>
                    </View>
                  );
                })}
              </View>
            ) : locationSource === "saved" ? (
              <ThemedText
                type="small"
                themeColor="textSecondary"
                style={styles.message}
              >
                {t(
                  "planner.noSavedLocations",
                  DEFAULT_LOCALE,
                  "No saved locations yet. Save a search result to reuse it here.",
                )}
              </ThemedText>
            ) : null}

            {isWeb ? (
              <View style={styles.selectedSection}>
                {!backgroundMap ? (
                  <>
                    <ThemedText type="smallBold">
                      {t("planner.mapPreview", DEFAULT_LOCALE, "Map preview")}
                    </ThemedText>
                    <View style={styles.mapWrapper}>
                      <View ref={mapContainerRef} style={styles.mapContainer} />
                      {!mapReady ? (
                        <ThemedText
                          type="small"
                          themeColor="textSecondary"
                          style={styles.mapNote}
                        >
                          {t(
                            "planner.mapPreviewHint",
                            DEFAULT_LOCALE,
                            "Map preview is loading. Search and select a location to fly to it.",
                          )}
                        </ThemedText>
                      ) : null}
                      {mapError ? (
                        <ThemedText
                          type="small"
                          themeColor="textSecondary"
                          style={styles.mapNote}
                        >
                          {mapError}
                        </ThemedText>
                      ) : null}
                    </View>
                  </>
                ) : null}

                <View style={styles.routeSection}>
                  {singleLocationActivity ? null : (
                    <>
                      <ThemedText type="smallBold">
                        {t(
                          "planner.routePlanner",
                          DEFAULT_LOCALE,
                          "Route planner",
                        )}
                      </ThemedText>

                      <View style={styles.selectorRow}>
                        {ROUTE_SERVICES.map((service) => (
                          <Pressable
                            key={service.key}
                            onPress={() => setRouteService(service.key)}
                            style={({ pressed }) => [
                              styles.selectorButton,
                              routeService === service.key &&
                                styles.selectorButtonActive,
                              pressed && styles.buttonPressed,
                            ]}
                          >
                            <ThemedText
                              type="smallBold"
                              style={{
                                color:
                                  routeService === service.key
                                    ? "#ffffff"
                                    : theme.text,
                              }}
                            >
                              {service.label}
                            </ThemedText>
                          </Pressable>
                        ))}
                      </View>

                      <View style={styles.selectorRow}>
                        {TRAVEL_MODES.map((mode) => (
                          <Pressable
                            key={mode.key}
                            onPress={() => setTravelMode(mode.key)}
                            style={({ pressed }) => [
                              styles.selectorButton,
                              travelMode === mode.key &&
                                styles.selectorButtonActive,
                              pressed && styles.buttonPressed,
                            ]}
                          >
                            <ThemedText
                              type="smallBold"
                              style={{
                                color:
                                  travelMode === mode.key
                                    ? "#ffffff"
                                    : theme.text,
                              }}
                            >
                              {mode.label}
                            </ThemedText>
                          </Pressable>
                        ))}
                      </View>

                      <Pressable
                        onPress={() => calculateRoute()}
                        disabled={
                          !routeOrigin || !routeDestination || routeLoading
                        }
                        style={({ pressed }) => [
                          styles.button,
                          styles.routeButton,
                          {
                            backgroundColor:
                              routeOrigin && routeDestination
                                ? theme.backgroundElement
                                : theme.background,
                          },
                          pressed && styles.buttonPressed,
                        ]}
                      >
                        <ThemedText type="smallBold">
                          {routeLoading
                            ? t(
                                "planner.routeLoading",
                                DEFAULT_LOCALE,
                                "Calculating route…",
                              )
                            : t(
                                "planner.findRoute",
                                DEFAULT_LOCALE,
                                "Find route",
                              )}
                        </ThemedText>
                      </Pressable>

                      <Pressable
                        onPress={() => void generateRoutePoiSuggestion()}
                        disabled={
                          !routeOrigin || !routeDestination || routePoiLoading
                        }
                        style={({ pressed }) => [
                          styles.button,
                          styles.routeButton,
                          {
                            backgroundColor:
                              routeOrigin && routeDestination
                                ? theme.backgroundElement
                                : theme.background,
                          },
                          pressed && styles.buttonPressed,
                        ]}
                      >
                        <ThemedText type="smallBold">
                          {routePoiLoading
                            ? t(
                                "planner.poiLoading",
                                DEFAULT_LOCALE,
                                "Generating POI…",
                              )
                            : t(
                                "planner.generatePoi",
                                DEFAULT_LOCALE,
                                "Generate POI hint",
                              )}
                        </ThemedText>
                      </Pressable>

                      <View style={styles.routeMetricsRow}>
                        <TextInput
                          value={routeDistanceKm}
                          onChangeText={setRouteDistanceKm}
                          placeholder={
                            travelMode === "plane"
                              ? t(
                                  "planner.distance",
                                  DEFAULT_LOCALE,
                                  "Distance",
                                )
                              : `${t("planner.distance", DEFAULT_LOCALE, "Distance")} (km)`
                          }
                          placeholderTextColor={theme.textSecondary}
                          keyboardType="decimal-pad"
                          autoCapitalize="none"
                          autoCorrect={false}
                          editable={
                            travelMode !== "plane" && travelMode !== "ferry"
                          }
                          style={[
                            styles.input,
                            styles.metricInput,
                            {
                              backgroundColor: theme.background,
                              color: theme.text,
                            },
                          ]}
                        />
                        <TextInput
                          value={routeTravelMinutes}
                          onChangeText={setRouteTravelMinutes}
                          placeholder={t(
                            "planner.travelTime",
                            DEFAULT_LOCALE,
                            "Travel time (minutes)",
                          )}
                          placeholderTextColor={theme.textSecondary}
                          keyboardType="number-pad"
                          autoCapitalize="none"
                          autoCorrect={false}
                          style={[
                            styles.input,
                            styles.metricInput,
                            {
                              backgroundColor: theme.background,
                              color: theme.text,
                            },
                          ]}
                        />
                      </View>
                    </>
                  )}

                  <View style={styles.activityFieldsSection}>
                    <TextInput
                      value={activityDescription}
                      onChangeText={setActivityDescription}
                      placeholder={t(
                        "planner.activityName",
                        DEFAULT_LOCALE,
                        "Activity name",
                      )}
                      placeholderTextColor={theme.textSecondary}
                      autoCapitalize="sentences"
                      autoCorrect={false}
                      style={[
                        styles.input,
                        {
                          backgroundColor: theme.background,
                          color: theme.text,
                        },
                      ]}
                    />
                    {singleLocationActivity ? (
                      <TextInput
                        value={activityDurationMinutes}
                        onChangeText={setActivityDurationMinutes}
                        placeholder={t(
                          "planner.activityDuration",
                          DEFAULT_LOCALE,
                          "Time needed in minutes",
                        )}
                        placeholderTextColor={theme.textSecondary}
                        keyboardType="number-pad"
                        autoCapitalize="none"
                        autoCorrect={false}
                        style={[
                          styles.input,
                          {
                            backgroundColor: theme.background,
                            color: theme.text,
                          },
                        ]}
                      />
                    ) : null}
                    <TextInput
                      value={activityMoreDetails}
                      onChangeText={setActivityMoreDetails}
                      placeholder={t(
                        "planner.moreDetails",
                        DEFAULT_LOCALE,
                        "More details or public ChatGPT share URL",
                      )}
                      placeholderTextColor={theme.textSecondary}
                      multiline
                      numberOfLines={4}
                      textAlignVertical="top"
                      autoCapitalize="sentences"
                      autoCorrect={false}
                      style={[
                        styles.input,
                        styles.multilineInput,
                        {
                          backgroundColor: theme.background,
                          color: theme.text,
                        },
                      ]}
                    />
                    {activityMoreDetails.trim() ? (
                      <Pressable
                        onPress={() => void handleImportChatDetails()}
                        disabled={chatLinkExtractLoading}
                        style={({ pressed }) => [
                          styles.button,
                          styles.routeButton,
                          {
                            backgroundColor: theme.backgroundElement,
                          },
                          pressed && styles.buttonPressed,
                        ]}
                      >
                        <ThemedText type="smallBold">
                          {chatLinkExtractLoading
                            ? t(
                                "planner.readingChat",
                                DEFAULT_LOCALE,
                                "Reading chat…",
                              )
                            : t(
                                "planner.useSharedChat",
                                DEFAULT_LOCALE,
                                "Use shared chat text",
                              )}
                        </ThemedText>
                      </Pressable>
                    ) : null}
                  </View>

                  {routeMessage ? (
                    <ThemedText
                      type="small"
                      themeColor="textSecondary"
                      style={styles.mapNote}
                    >
                      {routeMessage}
                    </ThemedText>
                  ) : null}

                  {message && singleLocationActivity ? (
                    <ThemedText
                      type="small"
                      themeColor="textSecondary"
                      style={styles.mapNote}
                    >
                      {message}
                    </ThemedText>
                  ) : null}

                  {canShowSingleSaveButton ? (
                    <Pressable
                      onPress={saveSingleLocationSegment}
                      disabled={activitySaveLoading}
                      style={({ pressed }) => [
                        styles.accentSaveButton,
                        activitySaveLoading && styles.buttonPressed,
                        pressed && styles.buttonPressed,
                      ]}
                    >
                      <ThemedText
                        type="smallBold"
                        style={styles.accentSaveText}
                      >
                        {activitySaveLoading
                          ? t(
                              "planner.savingActivity",
                              DEFAULT_LOCALE,
                              "Saving activity…",
                            )
                          : t(
                              "planner.saveActivity",
                              DEFAULT_LOCALE,
                              "Save activity as day segment",
                            )}
                      </ThemedText>
                    </Pressable>
                  ) : null}

                  {canShowRouteSaveButton ? (
                    <Pressable
                      onPress={saveRouteSegment}
                      disabled={routeSaveLoading}
                      style={({ pressed }) => [
                        styles.accentSaveButton,
                        routeSaveLoading && styles.buttonPressed,
                        pressed && styles.buttonPressed,
                      ]}
                    >
                      <ThemedText
                        type="smallBold"
                        style={styles.accentSaveText}
                      >
                        {routeSaveLoading
                          ? t(
                              "planner.savingSegment",
                              DEFAULT_LOCALE,
                              "Saving segment…",
                            )
                          : t(
                              "planner.generateSegment",
                              DEFAULT_LOCALE,
                              "Generate segment",
                            )}
                      </ThemedText>
                    </Pressable>
                  ) : null}

                  {!activeTripId || !activeDay ? (
                    <ThemedText
                      type="small"
                      themeColor="textSecondary"
                      style={styles.mapNote}
                    >
                      Open Location Lookup from a trip day to save segments.
                    </ThemedText>
                  ) : null}
                </View>
              </View>
            ) : (
              <ThemedText
                type="small"
                themeColor="textSecondary"
                style={styles.mapNote}
              >
                Map preview is available on the web build.
              </ThemedText>
            )}
          </ScrollView>
        </ThemedView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { gap: Spacing.three, padding: Spacing.three },
  backgroundRoot: {
    flex: 1,
    position: "relative",
    overflow: "hidden",
  },
  backgroundMapContainer: {
    ...StyleSheet.absoluteFill,
    backgroundColor: "#eef2ff",
    zIndex: 0,
    pointerEvents: "auto",
  },
  modeToggleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderRadius: Spacing.two,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.18)",
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    backgroundColor: "rgba(255,255,255,0.04)",
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  closeButton: {
    width: 30,
    height: 30,
    borderRadius: Spacing.two,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.14)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.24)",
  },
  closeButtonText: {
    color: "#F9FAFB",
  },
  sourceToggleRow: {
    flexDirection: "row",
    gap: Spacing.two,
    flexWrap: "wrap",
  },
  searchFieldWrapper: {
    flex: 1,
    gap: Spacing.one,
  },
  searchLabel: {
    color: "#E5E7EB",
  },
  sourceToggleButton: {
    borderRadius: Spacing.two,
    borderWidth: 1,
    borderColor: "#d1d5db",
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    backgroundColor: "transparent",
  },
  sourceToggleButtonActive: {
    backgroundColor: "#0b74de",
    borderColor: "#0b74de",
  },
  formRow: { flexDirection: "row", gap: Spacing.two, alignItems: "center" },
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
  input: {
    flex: 1,
    padding: Spacing.two,
    borderRadius: Spacing.two,
    borderWidth: 1,
    borderColor: "#e5e7eb",
  },
  button: {
    marginLeft: Spacing.two,
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.two,
    borderRadius: Spacing.two,
  },
  buttonPressed: { opacity: 0.8 },
  message: { marginTop: Spacing.two },
  resultsContainer: { gap: Spacing.two, marginTop: Spacing.two },
  resultItem: {
    padding: Spacing.three,
    borderRadius: Spacing.two,
    borderWidth: 1,
    borderColor: "#e5e7eb",
  },
  resultPressed: { opacity: 0.7 },
  resultItemWrapper: { gap: Spacing.two },
  actionButton: {
    alignSelf: "flex-start",
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    marginTop: Spacing.one,
  },
  removeLocationButton: {
    backgroundColor: "rgba(239,68,68,0.18)",
    borderWidth: 1,
    borderColor: "rgba(239,68,68,0.5)",
  },
  removeLocationText: {
    color: "#fecaca",
  },
  resultActionRow: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.two },
  routeSection: { gap: Spacing.two, marginTop: Spacing.three },
  routeDetails: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.two },
  routeMetricsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.two,
  },
  metricInput: {
    minWidth: 180,
    flexGrow: 1,
  },
  activityFieldsSection: {
    gap: Spacing.two,
    marginTop: Spacing.one,
  },
  multilineInput: {
    minHeight: 100,
  },
  routeDetailCard: {
    flex: 1,
    minWidth: 180,
    padding: Spacing.three,
    borderRadius: Spacing.three,
    borderWidth: 1,
    borderColor: "#d1d5db",
  },
  routeButton: {
    alignSelf: "flex-start",
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.three,
    marginTop: Spacing.one,
  },
  routeStopsPanel: {
    position: "absolute",
    right: 20,
    top: 78,
    width: 270,
    maxWidth: "32%",
    zIndex: 4,
    pointerEvents: "box-none",
  },
  routeStopsPanelInner: {
    backgroundColor: "rgba(15, 23, 42, 0.82)",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(148, 163, 184, 0.55)",
    padding: 12,
    gap: 8,
    shadowColor: "#000",
    shadowOpacity: 0.22,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 8 },
  },
  routeStopCard: {
    backgroundColor: "rgba(255, 255, 255, 0.08)",
    borderRadius: 10,
    padding: 8,
    gap: 6,
  },
  routeStopHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  routeStopNumber: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: "#fbbf24",
    color: "#111827",
    textAlign: "center",
    lineHeight: 24,
    overflow: "hidden",
  },
  routeStopName: {
    flex: 1,
    color: "#f8fafc",
  },
  routeStopActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 6,
  },
  routeStopActionButton: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    backgroundColor: "rgba(148, 163, 184, 0.2)",
  },
  routeStopActionDisabled: {
    opacity: 0.35,
  },
  routeSaveButton: {
    alignSelf: "flex-start",
    marginLeft: 0,
    marginTop: Spacing.one,
  },
  accentSaveButton: {
    alignSelf: "flex-start",
    marginTop: Spacing.one,
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.three,
    backgroundColor: "#f97316",
  },
  accentSaveText: {
    color: "#fff7ed",
  },
  selectorRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.two,
    marginTop: Spacing.one,
  },
  selectorButton: {
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderWidth: 1,
    borderColor: "#d1d5db",
    backgroundColor: "transparent",
  },
  selectorButtonActive: {
    backgroundColor: "#0b74de",
    borderColor: "#0b74de",
  },
  selectedSection: { gap: Spacing.two },
  selectedName: { marginTop: Spacing.one },
  singleLocationSection: {
    gap: Spacing.two,
    marginTop: Spacing.three,
  },
  selectedDetails: { gap: Spacing.one, marginTop: Spacing.two },
  mapWrapper: { marginTop: Spacing.three, overflow: "hidden" },
  mapContainer: {
    width: "100%",
    height: 360,
    maxHeight: 420,
    minHeight: 320,
    borderRadius: Spacing.three,
    overflow: "hidden",
    backgroundColor: "#eef2ff",
    touchAction: "none",
  },
  mapNote: { marginTop: Spacing.two },
  card: {
    borderRadius: Spacing.four,
    alignSelf: "stretch",
    backgroundColor: "#1f2937",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.05)",
    overflow: "hidden",
    flex: 1,
  },
  cardScrollView: {
    flex: 1,
    backgroundColor: "transparent",
  },
  cardContent: {
    gap: Spacing.three,
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.five,
  },
  overlayCard: {
    position: "absolute",
    left: Spacing.four,
    top: Spacing.four,
    bottom: Spacing.four,
    width: "46%",
    maxWidth: 480,
    minWidth: 280,
    marginTop: 0,
    marginLeft: 0,
    backgroundColor: "rgba(17, 24, 39, 0.88)",
    borderColor: "rgba(255,255,255,0.12)",
    shadowColor: "#000",
    shadowOpacity: 0.25,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    zIndex: 2,
    pointerEvents: "box-none",
  },
});
