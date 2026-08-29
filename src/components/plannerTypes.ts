export interface RouteStop {
  display_name: string;
  lat: number;
  lon: number;
}

export interface Segment {
  id: string;
  startTime: string;
  endTime: string;
  activityDescription: string;
  details?: string;
  locationMode: "single" | "route";
  location?: string;
  locationLat?: number;
  locationLon?: number;
  startLocation?: string;
  startLocationLat?: number;
  startLocationLon?: number;
  endLocation?: string;
  endLocationLat?: number;
  endLocationLon?: number;
  routeStops?: RouteStop[];
  commuteType?: "car" | "walking" | "plane" | "ferry";
  routeDistanceKm?: number;
  routeTravelMinutes?: number;
  routeMapUrl?: string;
}

export interface DayPlan {
  segments: Segment[];
  availableSegments?: Segment[];
}

export interface Plan {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  createdAt: string;
  updatedAt: string;
  days?: Record<string, DayPlan>;
}
