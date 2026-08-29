import type { Segment } from "./plannerTypes";

export type SegmentCardColors = {
  background: string;
  border: string;
  title: string;
  detail: string;
  badgeBackground: string;
  badgeText: string;
};

export function parseDay(day: string): Date {
  return new Date(`${day}T00:00:00`);
}

export function toDayString(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function enumarateDays(start: string, end: string): string[] {
  const days: string[] = [];
  let cur = parseDay(start);
  const last = parseDay(end);
  while (cur <= last) {
    days.push(toDayString(cur));
    cur = new Date(cur.getFullYear(), cur.getMonth(), cur.getDate() + 1);
  }
  return days;
}

export function formatDayLabel(day: string, long = false): string {
  return parseDay(day).toLocaleDateString(
    undefined,
    long
      ? { weekday: "long", year: "numeric", month: "long", day: "numeric" }
      : { weekday: "short", month: "short", day: "numeric" },
  );
}

export function segmentLocationText(seq: Segment): string {
  return seq.locationMode === "route"
    ? `${seq.startLocation} → ${seq.endLocation}`
    : seq.location || "";
}

export function segmentStartLocation(seq: Segment): string {
  return seq.locationMode === "route"
    ? seq.startLocation || ""
    : seq.location || "";
}

export function segmentEndLocation(seq: Segment): string {
  return seq.locationMode === "route"
    ? seq.endLocation || ""
    : seq.location || "";
}

export function segmentDurationMinutes(segment: Segment): number {
  const [startHours, startMinutes] = segment.startTime.split(":").map(Number);
  const [endHours, endMinutes] = segment.endTime.split(":").map(Number);
  return endHours * 60 + endMinutes - (startHours * 60 + startMinutes);
}

export function formatSegmentDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;

  if (!hours) {
    return `${minutes} min`;
  }

  return remainder ? `${hours}h ${remainder}m` : `${hours}h`;
}

export function segmentTypeLabel(segment: Segment): string {
  if (segment.locationMode === "single") {
    return "Single location";
  }

  if (segment.commuteType === "walking") {
    return "Walking route";
  }

  if (segment.commuteType === "plane") {
    return "Plane route";
  }

  if (segment.commuteType === "ferry") {
    return "Ferry route";
  }

  return "Car route";
}

export function segmentCardColors(segment: Segment): SegmentCardColors {
  if (segment.locationMode === "single") {
    return {
      background:
        "linear-gradient(180deg, rgba(14,165,233,0.22), rgba(14,165,233,0.12))",
      border: "rgba(14,165,233,0.5)",
      title: "#082f49",
      detail: "#0f172a",
      badgeBackground: "rgba(8,145,178,0.18)",
      badgeText: "#0c4a6e",
    };
  }

  if (segment.commuteType === "walking") {
    return {
      background:
        "linear-gradient(180deg, rgba(34,197,94,0.24), rgba(34,197,94,0.12))",
      border: "rgba(22,163,74,0.48)",
      title: "#14532d",
      detail: "#14532d",
      badgeBackground: "rgba(34,197,94,0.18)",
      badgeText: "#166534",
    };
  }

  if (segment.commuteType === "plane") {
    return {
      background:
        "linear-gradient(180deg, rgba(99,102,241,0.22), rgba(99,102,241,0.12))",
      border: "rgba(99,102,241,0.48)",
      title: "#312e81",
      detail: "#312e81",
      badgeBackground: "rgba(99,102,241,0.18)",
      badgeText: "#3730a3",
    };
  }

  if (segment.commuteType === "ferry") {
    return {
      background:
        "linear-gradient(180deg, rgba(45,212,191,0.22), rgba(45,212,191,0.12))",
      border: "rgba(13,148,136,0.48)",
      title: "#134e4a",
      detail: "#134e4a",
      badgeBackground: "rgba(45,212,191,0.18)",
      badgeText: "#115e59",
    };
  }

  return {
    background:
      "linear-gradient(180deg, rgba(249,115,22,0.24), rgba(249,115,22,0.12))",
    border: "rgba(234,88,12,0.48)",
    title: "#7c2d12",
    detail: "#7c2d12",
    badgeBackground: "rgba(249,115,22,0.18)",
    badgeText: "#9a3412",
  };
}
