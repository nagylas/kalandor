import {
    readTripsFromFile,
    sortTripsByStartDate,
    writeTripsToFile,
    type SavedTripLocation,
} from "./plannerStorage";

export type SavedLocation = SavedTripLocation;

export async function readSavedLocations(
  tripId: string,
): Promise<SavedLocation[]> {
  const trips = await readTripsFromFile();
  const trip = trips.find((item) => item.id === tripId);
  if (!trip) {
    return [];
  }

  return [...(trip.savedLocations ?? [])].sort((a, b) =>
    b.savedAt.localeCompare(a.savedAt),
  );
}

async function writeSavedLocations(tripId: string, locations: SavedLocation[]) {
  const trips = await readTripsFromFile();
  const targetTrip = trips.find((trip) => trip.id === tripId);
  if (!targetTrip) {
    return [] as SavedLocation[];
  }

  const deduped = locations.reduce<SavedLocation[]>((acc, location) => {
    if (acc.some((item) => item.place_id === location.place_id)) {
      return acc;
    }
    acc.push(location);
    return acc;
  }, []);

  const updatedTrips = trips.map((trip) =>
    trip.id !== tripId ? trip : { ...trip, savedLocations: deduped },
  );

  await writeTripsToFile(sortTripsByStartDate(updatedTrips));
  return deduped;
}

export async function upsertSavedLocation(
  tripId: string,
  location: Omit<SavedLocation, "savedAt">,
): Promise<SavedLocation[]> {
  const current = await readSavedLocations(tripId);
  const next: SavedLocation = {
    ...location,
    savedAt: new Date().toISOString(),
  };

  const withoutCurrent = current.filter(
    (item) => item.place_id !== next.place_id,
  );
  const updated = [next, ...withoutCurrent];
  return writeSavedLocations(tripId, updated);
}

export async function removeSavedLocation(
  tripId: string,
  placeId: string,
): Promise<SavedLocation[]> {
  const current = await readSavedLocations(tripId);
  const updated = current.filter((item) => item.place_id !== placeId);
  return writeSavedLocations(tripId, updated);
}
