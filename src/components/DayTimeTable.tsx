import { useEffect, useRef, useState } from "react";
import type { Segment } from "./plannerTypes";
import { segmentCardColors, segmentDurationMinutes } from "./plannerUtils";

const BLOCK_MINUTES = 15;
const BLOCKS_PER_HOUR = 60 / BLOCK_MINUTES;
const TOTAL_BLOCKS = 24 * BLOCKS_PER_HOUR;
const DEFAULT_VIEW_START_HOUR = 8;
const DEFAULT_VIEW_END_HOUR = 22;
const VISIBLE_BLOCKS =
  (DEFAULT_VIEW_END_HOUR - DEFAULT_VIEW_START_HOUR) * BLOCKS_PER_HOUR;
const BLOCK_HEIGHT = 18;
const TIME_COLUMN_WIDTH = 64;
const CONTENT_GUTTER = 8;

type SegmentWeather = {
  temperatureC: number | null;
  precipitationMm: number | null;
  sky: string;
  loading: boolean;
};

const WEATHER_CODE_LABELS: Record<number, string> = {
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
};

function getSegmentWeatherLocation(segment: Segment): string {
  if (segment.locationMode === "route") {
    return (
      segment.startLocation?.trim() ||
      segment.endLocation?.trim() ||
      segment.location?.trim() ||
      ""
    );
  }

  return segment.location?.trim() || "";
}

function getSegmentWeatherCoordinates(
  segment: Segment,
): { latitude: number; longitude: number } | null {
  if (segment.locationMode === "single") {
    const latitude = segment.locationLat;
    const longitude = segment.locationLon;

    if (typeof latitude === "number" && typeof longitude === "number") {
      if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
        return { latitude, longitude };
      }
    }
  }

  if (segment.locationMode === "route") {
    const latitude = segment.startLocationLat;
    const longitude = segment.startLocationLon;

    if (typeof latitude === "number" && typeof longitude === "number") {
      if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
        return { latitude, longitude };
      }
    }
  }

  return null;
}

function fetchWeatherDescription(code: number | null | undefined): string {
  if (!Number.isFinite(Number(code))) {
    return "Unavailable";
  }

  const normalizedCode = Number(code);
  return WEATHER_CODE_LABELS[normalizedCode] ?? "Conditions";
}

function logWeatherIssue(
  _segment: Segment,
  _day: string,
  _stage: string,
  _details: Record<string, unknown>,
) {
  // Intentionally silent to avoid noisy weather logs during export.
}

async function fetchWeatherForSegment(
  segment: Segment,
  day: string,
): Promise<SegmentWeather> {
  if (segment.locationMode !== "single") {
    return {
      temperatureC: null,
      precipitationMm: null,
      sky: "—",
      loading: false,
    };
  }

  const queryLocation = getSegmentWeatherLocation(segment);
  if (!queryLocation) {
    logWeatherIssue(segment, day, "missing-location", {
      queryLocation: "",
      reason: "Segment has no usable location for weather lookup.",
    });
    return {
      temperatureC: null,
      precipitationMm: null,
      sky: "No location",
      loading: false,
    };
  }

  try {
    const coordinates = getSegmentWeatherCoordinates(segment);

    if (!coordinates) {
      logWeatherIssue(segment, day, "missing-coordinate-data", {
        queryLocation,
        reason:
          "Only coordinate-backed locations are supported; clear old address-only entries.",
      });
      throw new Error(
        "Only coordinate-backed locations are supported; clear old address-only entries.",
      );
    }

    const forecastResponse = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${coordinates.latitude}&longitude=${coordinates.longitude}&hourly=temperature_2m,precipitation,weather_code&timezone=auto&start_date=${day}&end_date=${day}`,
    );

    if (!forecastResponse.ok) {
      const errorText = await forecastResponse.text();
      logWeatherIssue(segment, day, "forecast-request-failed", {
        queryLocation,
        latitude: coordinates.latitude,
        longitude: coordinates.longitude,
        status: forecastResponse.status,
        statusText: forecastResponse.statusText,
        responseBody: errorText,
      });
      throw new Error(`Forecast lookup failed (${forecastResponse.status}).`);
    }

    const forecastData = (await forecastResponse.json()) as {
      hourly?: {
        time?: string[];
        temperature_2m?: number[];
        precipitation?: number[];
        weather_code?: number[];
      };
    };

    const times = forecastData.hourly?.time ?? [];
    const temperatures = forecastData.hourly?.temperature_2m ?? [];
    const precipitationValues = forecastData.hourly?.precipitation ?? [];
    const weatherCodes = forecastData.hourly?.weather_code ?? [];

    if (times.length === 0 || temperatures.length === 0) {
      throw new Error("Forecast response is missing the expected hourly data.");
    }

    const hourIndex = Math.min(
      Math.max(Math.floor(timeToMinutes(segment.startTime) / 60), 0),
      Math.max(times.length - 1, 0),
    );

    const temperature = temperatures[hourIndex] ?? null;
    const precipitation = precipitationValues[hourIndex] ?? null;
    const weatherCode = weatherCodes[hourIndex] ?? null;

    return {
      temperatureC:
        typeof temperature === "number" && Number.isFinite(temperature)
          ? temperature
          : null,
      precipitationMm:
        typeof precipitation === "number" && Number.isFinite(precipitation)
          ? precipitation
          : null,
      sky: fetchWeatherDescription(weatherCode),
      loading: false,
    };
  } catch {
    return {
      temperatureC: null,
      precipitationMm: null,
      sky: "Unavailable",
      loading: false,
    };
  }
}

function blockTimeString(block: number): string {
  const totalMinutes = block * BLOCK_MINUTES;
  return `${String(Math.floor(totalMinutes / 60)).padStart(2, "0")}:${String(totalMinutes % 60).padStart(2, "0")}`;
}

function timeToMinutes(t: string): number {
  const [hours, minutes] = t.split(":").map(Number);
  return hours * 60 + minutes;
}

function formatTravelTimeRange(start: string, end: string): string {
  const [startHours = 0, startMinutes = 0] = start.split(":").map(Number);
  const [endHours = 0, endMinutes = 0] = end.split(":").map(Number);
  const startLabel = `${String(startHours).padStart(2, "0")}:${String(startMinutes).padStart(2, "0")}`;
  const endLabel = `${String(endHours).padStart(2, "0")}:${String(endMinutes).padStart(2, "0")}`;
  return `${startLabel}-${endLabel}`;
}

function travelTypeText(segment: Segment): string {
  if (segment.locationMode !== "route") {
    return "";
  }

  if (segment.commuteType === "walking") {
    return "Walking";
  }

  if (segment.commuteType === "plane") {
    return "By plane";
  }

  if (segment.commuteType === "ferry") {
    return "By ferry";
  }

  return "By car";
}

function distanceText(segment: Segment): string {
  if (segment.locationMode !== "route") {
    return "";
  }

  if (typeof segment.routeDistanceKm !== "number") {
    return "";
  }

  return `${segment.routeDistanceKm.toFixed(1)} km`;
}

function routeLocationsText(segment: Segment): string {
  if (segment.locationMode !== "route") {
    return segment.location?.trim() || "";
  }

  const start = segment.startLocation?.trim() || "";
  const end = segment.endLocation?.trim() || "";
  if (!start && !end) {
    return "";
  }

  return `${start} -> ${end}`;
}

const PX_PER_MINUTE = BLOCK_HEIGHT / BLOCK_MINUTES;

function assignLanes(
  segments: Segment[],
): { seg: Segment; lane: number; lanes: number }[] {
  const sorted = [...segments].sort(
    (a, b) =>
      a.startTime.localeCompare(b.startTime) ||
      a.endTime.localeCompare(b.endTime),
  );
  const laneEndTimes: string[] = [];
  const placements = sorted.map((seg) => {
    let lane = laneEndTimes.findIndex((end) => end <= seg.startTime);
    if (lane === -1) {
      lane = laneEndTimes.length;
      laneEndTimes.push(seg.endTime);
    } else laneEndTimes[lane] = seg.endTime;
    return { seg, lane };
  });
  const lanes = Math.max(laneEndTimes.length, 1);
  return placements.map((p) => ({ ...p, lanes }));
}

export function DayTimeTable({
  segments,
  dayDate,
  draggingSegmentId,
  onDropSegment,
  onDragStateChange,
  onReturnSegmentToList,
}: {
  segments: Segment[];
  dayDate: string | null;
  draggingSegmentId: string | null;
  onDropSegment: (segmentId: string, blockStart: string) => void;
  onDragStateChange: (segmentId: string | null) => void;
  onReturnSegmentToList: (segmentId: string) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [hoveredBlock, setHoveredBlock] = useState<number | null>(null);
  const [weatherBySegmentId, setWeatherBySegmentId] = useState<
    Record<string, SegmentWeather>
  >({});

  useEffect(() => {
    if (scrollRef.current) {
      const scrollTop =
        DEFAULT_VIEW_START_HOUR * BLOCKS_PER_HOUR * BLOCK_HEIGHT;
      scrollRef.current.scrollTop = scrollTop;
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    const loadWeather = async () => {
      if (!dayDate) {
        setWeatherBySegmentId({});
        return;
      }

      setWeatherBySegmentId((current) => {
        const next = { ...current };
        for (const segment of segments) {
          next[segment.id] = {
            temperatureC: current[segment.id]?.temperatureC ?? null,
            precipitationMm: current[segment.id]?.precipitationMm ?? null,
            sky: current[segment.id]?.sky ?? "Loading",
            loading: true,
          };
        }
        return next;
      });

      const weatherResults = await Promise.all(
        segments.map(async (segment) => ({
          id: segment.id,
          weather: await fetchWeatherForSegment(segment, dayDate),
        })),
      );

      if (cancelled) {
        return;
      }

      setWeatherBySegmentId((current) => {
        const next = { ...current };
        for (const item of weatherResults) {
          next[item.id] = item.weather;
        }
        return next;
      });
    };

    void loadWeather();
    return () => {
      cancelled = true;
    };
  }, [segments, dayDate]);

  const blocks = Array.from({ length: TOTAL_BLOCKS }, (_, i) => i);

  const lanePlacements = assignLanes(segments);

  return (
    <div
      style={{
        flex: "1 1 auto",
        display: "flex",
        flexDirection: "column",
        minWidth: "300px",
        minHeight: 0,
        width: "100%",
        height: "100%",
        overflow: "hidden",
      }}
    >
      <div
        ref={scrollRef}
        style={{
          flex: 1,
          height: "100%",
          maxHeight: "100%",
          minHeight: 0,
          overflowY: "auto",
          border: "1px solid rgba(15, 23, 42, 0.12)",
          borderRadius: 10,
          backgroundColor: "beige",
        }}
      >
        <div
          style={{
            position: "relative",
            height: TOTAL_BLOCKS * BLOCK_HEIGHT,
          }}
        >
          {blocks.map((block) => {
            const isHourStart = block % BLOCKS_PER_HOUR === 0;
            const isHovered = hoveredBlock === block;

            return (
              <div
                key={block}
                onDragOver={(event) => {
                  event.preventDefault();
                  if (hoveredBlock !== block) {
                    setHoveredBlock(block);
                  }
                }}
                onDragLeave={() => {
                  if (hoveredBlock === block) {
                    setHoveredBlock(null);
                  }
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  const segmentId = event.dataTransfer.getData(
                    "application/x-kalandor-segment",
                  );
                  setHoveredBlock(null);
                  if (segmentId) {
                    onDropSegment(segmentId, blockTimeString(block));
                  }
                }}
                style={{
                  display: "flex",
                  height: BLOCK_HEIGHT,
                  boxSizing: "border-box",
                  borderTop:
                    block === 0
                      ? undefined
                      : isHourStart
                        ? "1px solid rgba(15, 23, 42, 0.14)"
                        : "1px dashed rgba(15, 23, 42, 0.05)",
                  background: isHovered
                    ? "rgba(249, 115, 22, 0.18)"
                    : undefined,
                }}
              >
                <div
                  style={{
                    flex: `0 0 ${TIME_COLUMN_WIDTH}px`,
                    padding: "0 8px",
                    boxSizing: "border-box",
                    fontSize: "0.66rem",
                    lineHeight: `${BLOCK_HEIGHT}px`,
                    color: "#64748b",
                    fontWeight: 700,
                    background: "#f8fafc",
                  }}
                >
                  {isHourStart ? blockTimeString(block) : ""}
                </div>
                <div style={{ flex: 1 }} />
              </div>
            );
          })}

          <div
            style={{
              position: "absolute",
              top: 0,
              left: TIME_COLUMN_WIDTH + CONTENT_GUTTER,
              right: CONTENT_GUTTER,
              height: TOTAL_BLOCKS * BLOCK_HEIGHT,
              pointerEvents: "none",
            }}
          >
            {lanePlacements.map(({ seg, lane, lanes }) => {
              const top = timeToMinutes(seg.startTime) * PX_PER_MINUTE;
              const durationMinutes = segmentDurationMinutes(seg);
              const height = durationMinutes * PX_PER_MINUTE;
              const laneWidthPct = 100 / lanes;
              const colors = segmentCardColors(seg);
              const travelTime = formatTravelTimeRange(
                seg.startTime,
                seg.endTime,
              );
              const travelType = travelTypeText(seg);
              const distance = distanceText(seg);
              const routeLocations = routeLocationsText(seg);
              const isSingleLocationSegment = seg.locationMode === "single";
              const weather = isSingleLocationSegment
                ? (weatherBySegmentId[seg.id] ?? {
                    temperatureC: null,
                    precipitationMm: null,
                    sky: "Loading",
                    loading: true,
                  })
                : null;
              const formattedTemperature =
                isSingleLocationSegment &&
                typeof weather?.temperatureC === "number"
                  ? `${Math.round(weather.temperatureC)}°C`
                  : "";
              const formattedPrecipitation =
                isSingleLocationSegment &&
                typeof weather?.precipitationMm === "number"
                  ? `${weather.precipitationMm.toFixed(weather.precipitationMm >= 1 ? 1 : 0)} mm`
                  : "";
              const weatherSummary =
                isSingleLocationSegment && weather
                  ? weather.loading
                    ? "Checking…"
                    : weather.sky
                  : "";
              return (
                <div
                  key={seg.id}
                  draggable
                  onDragStart={(event) => {
                    event.dataTransfer.effectAllowed = "move";
                    event.dataTransfer.setData(
                      "application/x-kalandor-segment",
                      seg.id,
                    );
                    onDragStateChange(seg.id);
                  }}
                  onDragEnd={(event) => {
                    const droppedSegmentId = event.dataTransfer.getData(
                      "application/x-kalandor-segment",
                    );
                    onDragStateChange(null);

                    if (
                      droppedSegmentId &&
                      event.dataTransfer.dropEffect === "none"
                    ) {
                      onReturnSegmentToList(droppedSegmentId);
                    }
                  }}
                  style={{
                    position: "absolute",
                    top,
                    height,
                    left: `calc(${lane * laneWidthPct}% + 2px)`,
                    width: `calc(${laneWidthPct}% - 4px)`,
                    pointerEvents: "auto",
                    cursor: "grab",
                    overflow: "hidden",
                    boxSizing: "border-box",
                    display: "flex",
                    flexDirection: "column",
                    justifyContent: "center",
                    gap: "2px",
                    padding: "4px 8px",
                    borderRadius: 6,
                    border: `1px solid ${colors.border}`,
                    background:
                      draggingSegmentId === seg.id
                        ? "rgba(255,255,255,0.2)"
                        : colors.background,
                    opacity: draggingSegmentId === seg.id ? 0.45 : 1,
                  }}
                >
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns:
                        "110px minmax(0, 1.2fr) minmax(0, 0.9fr) minmax(0, 0.8fr) minmax(0, 1.8fr) minmax(0, 1.3fr)",
                      alignItems: "center",
                      columnGap: "6px",
                      rowGap: "0px",
                      fontSize: "0.92rem",
                      color: colors.detail,
                    }}
                  >
                    <span
                      style={{
                        fontWeight: 700,
                        color: colors.title,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {travelTime}
                    </span>
                    <span
                      style={{
                        fontWeight: 700,
                        color: colors.title,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {seg.activityDescription}
                    </span>
                    <span
                      style={{
                        fontWeight: 700,
                        color: colors.title,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {travelType}
                    </span>
                    <span
                      style={{
                        fontWeight: 700,
                        color: colors.title,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {distance}
                    </span>
                    <span
                      style={{
                        fontWeight: 700,
                        color: colors.title,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {routeLocations}
                    </span>
                    {!isSingleLocationSegment ? null : (
                      <div
                        title={`${weatherSummary} · ${formattedTemperature} · ${formattedPrecipitation}`}
                        style={{
                          display: "flex",
                          flexDirection: "row",
                          alignItems: "center",
                          justifyContent: "flex-end",
                          gap: "8px",
                          minWidth: 0,
                          textAlign: "right",
                          fontSize: "0.72rem",
                          color: colors.title,
                        }}
                      >
                        <span
                          style={{
                            fontWeight: 800,
                            whiteSpace: "nowrap",
                          }}
                        >
                          {formattedTemperature}
                        </span>
                        <span
                          style={{
                            whiteSpace: "nowrap",
                            opacity: 0.9,
                          }}
                        >
                          {formattedPrecipitation}
                        </span>
                        <span
                          style={{
                            whiteSpace: "nowrap",
                            opacity: 0.8,
                          }}
                        >
                          {weatherSummary}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

export default DayTimeTable;
