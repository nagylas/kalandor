import { useEffect, useState } from "react";
import { MonthCalendar } from "./monthcalendar";

type PlannerPageProps = {
  startDate?: string;
  endDate?: string;
  onRangeChange?: (startDate?: string, endDate?: string) => void;
  activeDay?: string;
  onActiveDayChange?: (day: string) => void;
  isTripLoaded?: boolean;
  compact?: boolean;
};

function toDayString(date: Date) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function PlannerPage({
  startDate,
  endDate,
  onRangeChange,
  activeDay,
  onActiveDayChange,
  isTripLoaded = false,
  compact = false,
}: PlannerPageProps) {
  const now = new Date();
  const today = toDayString(now);
  const [rangeStart, setRangeStart] = useState<string | undefined>(startDate);
  const [rangeEnd, setRangeEnd] = useState<string | undefined>(endDate);
  const [viewDate, setViewDate] = useState<Date>(() => {
    const anchor = startDate ? new Date(`${startDate}T00:00:00`) : now;
    return new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  });

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    setRangeStart(startDate);
    setRangeEnd(endDate);

    const anchor = startDate ? new Date(`${startDate}T00:00:00`) : now;
    setViewDate(new Date(anchor.getFullYear(), anchor.getMonth(), 1));
  }, [startDate, endDate]);
  /* eslint-enable react-hooks/set-state-in-effect */

  useEffect(() => {
    onRangeChange?.(rangeStart, rangeEnd);
  }, [rangeStart, rangeEnd, onRangeChange]);

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!isTripLoaded || !activeDay) {
      return;
    }

    const day = new Date(`${activeDay}T00:00:00`);
    setViewDate(new Date(day.getFullYear(), day.getMonth(), 1));
  }, [activeDay, isTripLoaded]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const handleSelectDay = (day: string) => {
    if (isTripLoaded && rangeStart && rangeEnd) {
      if (day < rangeStart || day > rangeEnd) {
        return;
      }

      onActiveDayChange?.(day);
      return;
    }

    if (!rangeStart) {
      setRangeStart(day);
      setRangeEnd(undefined);
      return;
    }

    if (!rangeEnd) {
      if (day === rangeStart) {
        setRangeStart(undefined);
        return;
      }

      if (day < rangeStart) {
        return;
      }

      setRangeEnd(day);
      return;
    }

    if (day === rangeStart || day === rangeEnd) {
      if (day === rangeEnd) {
        setRangeEnd(undefined);
        return;
      }

      if (day === rangeStart) {
        setRangeStart(rangeEnd);
        setRangeEnd(undefined);
        return;
      }

      return;
    }

    if (day < rangeStart) {
      return;
    }

    setRangeEnd(day);
  };

  const handlePrevMonth = () => {
    setViewDate(
      (current) => new Date(current.getFullYear(), current.getMonth() - 1, 1),
    );
  };

  const handleNextMonth = () => {
    setViewDate(
      (current) => new Date(current.getFullYear(), current.getMonth() + 1, 1),
    );
  };

  return (
    <MonthCalendar
      viewDate={viewDate}
      today={today}
      rangeStart={rangeStart}
      rangeEnd={rangeEnd}
      activeDay={activeDay}
      compact={compact}
      onSelect={handleSelectDay}
      onPrevMonth={handlePrevMonth}
      onNextMonth={handleNextMonth}
    />
  );
}
