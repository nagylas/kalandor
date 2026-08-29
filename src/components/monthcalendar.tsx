import { Pressable, StyleSheet, Text, View } from "react-native";
import { toDayString } from "./plannerUtils";

const WEEKDAYS_HEADER = ["S", "M", "T", "W", "T", "F", "S"];

export function MonthCalendar({
  viewDate,
  today,
  rangeStart,
  rangeEnd,
  activeDay,
  compact = false,
  onSelect,
  onPrevMonth,
  onNextMonth,
}: {
  viewDate: Date;
  today: string;
  rangeStart?: string;
  rangeEnd?: string;
  activeDay?: string;
  compact?: boolean;
  onSelect: (day: string) => void;
  onPrevMonth: () => void;
  onNextMonth: () => void;
}) {
  const firstOfMonth = new Date(viewDate.getFullYear(), viewDate.getMonth(), 1);
  const year = firstOfMonth.getFullYear();
  const month = firstOfMonth.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const monthLabel = firstOfMonth.toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
  });

  const totalCells = Math.ceil((firstOfMonth.getDay() + daysInMonth) / 7) * 7;
  const gridStart = new Date(year, month, 1 - firstOfMonth.getDay());
  const cells = Array.from(
    { length: totalCells },
    (_, i) =>
      new Date(
        gridStart.getFullYear(),
        gridStart.getMonth(),
        gridStart.getDate() + i,
      ),
  );

  return (
    <View style={[styles.container, compact && styles.containerCompact]}>
      <View style={styles.headerRow}>
        <Pressable
          onPress={onPrevMonth}
          style={[styles.navButton, compact && styles.navButtonCompact]}
        >
          <Text
            style={[
              styles.navButtonText,
              compact && styles.navButtonTextCompact,
            ]}
          >
            {"<"}
          </Text>
        </Pressable>
        <Text style={[styles.monthLabel, compact && styles.monthLabelCompact]}>
          {monthLabel}
        </Text>
        <Pressable
          onPress={onNextMonth}
          style={[styles.navButton, compact && styles.navButtonCompact]}
        >
          <Text
            style={[
              styles.navButtonText,
              compact && styles.navButtonTextCompact,
            ]}
          >
            {">"}
          </Text>
        </Pressable>
      </View>

      <View style={styles.grid}>
        {WEEKDAYS_HEADER.map((wd, i) => (
          <View
            key={i}
            style={[styles.weekdayCell, compact && styles.weekdayCellCompact]}
          >
            <Text
              style={[styles.weekdayText, compact && styles.weekdayTextCompact]}
            >
              {wd}
            </Text>
          </View>
        ))}
        {cells.map((cellDate, idx) => {
          const dayString = toDayString(cellDate);
          const isStart = Boolean(rangeStart && dayString === rangeStart);
          const isEnd = Boolean(rangeEnd && dayString === rangeEnd);
          const isInSelectedRange = Boolean(
            rangeStart &&
            rangeEnd &&
            dayString > rangeStart &&
            dayString < rangeEnd,
          );
          const isActiveDay = activeDay === dayString;
          const isToday = dayString === today;
          const isCurrentMonth = cellDate.getMonth() === month;

          return (
            <Pressable
              key={idx}
              onPress={() => onSelect(dayString)}
              style={[
                styles.dayCell,
                compact && styles.dayCellCompact,
                isInSelectedRange && styles.inRangeDay,
                (isStart || isEnd) && styles.selectedDay,
                isToday && styles.todayDay,
                isActiveDay && styles.activeDay,
                !isCurrentMonth && styles.outsideMonthDay,
              ]}
            >
              <Text
                style={[
                  styles.dayText,
                  compact && styles.dayTextCompact,
                  (isStart || isEnd) && styles.selectedDayText,
                  isToday && !(isStart || isEnd) && styles.todayDayText,
                  isActiveDay && styles.activeDayText,
                ]}
              >
                {cellDate.getDate()}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    minWidth: 240,
    gap: 8,
  },
  containerCompact: {
    gap: 4,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  monthLabel: {
    fontWeight: "700",
    color: "#e5e7eb",
    fontSize: 14,
  },
  monthLabelCompact: {
    fontSize: 13,
  },
  navButton: {
    width: 30,
    height: 30,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.08)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
  },
  navButtonCompact: {
    width: 24,
    height: 24,
    borderRadius: 6,
  },
  navButtonText: {
    color: "#f8fafc",
    fontSize: 16,
    fontWeight: "700",
    marginTop: -1,
  },
  navButtonTextCompact: {
    fontSize: 14,
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
  },
  weekdayCell: {
    width: "14.2857%",
    alignItems: "center",
    marginBottom: 4,
  },
  weekdayCellCompact: {
    marginBottom: 2,
  },
  weekdayText: {
    fontSize: 12,
    color: "#9ca3af",
    fontWeight: "700",
  },
  weekdayTextCompact: {
    fontSize: 11,
  },
  dayCell: {
    width: "14.2857%",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: "transparent",
    marginBottom: 4,
  },
  dayCellCompact: {
    paddingVertical: 4,
    borderRadius: 6,
    marginBottom: 2,
  },
  inRangeDay: {
    backgroundColor: "rgba(249, 115, 22, 0.3)",
  },
  selectedDay: {
    backgroundColor: "#f97316",
  },
  todayDay: {
    borderWidth: 1,
    borderColor: "#fb923c",
  },
  activeDay: {
    borderWidth: 2,
    borderColor: "#facc15",
  },
  outsideMonthDay: {
    opacity: 0.5,
  },
  dayText: {
    fontSize: 13,
    color: "#d1d5db",
  },
  dayTextCompact: {
    fontSize: 12,
  },
  todayDayText: {
    color: "#fdba74",
    fontWeight: "700",
  },
  selectedDayText: {
    color: "#ffffff",
    fontWeight: "700",
  },
  activeDayText: {
    color: "#fff7ed",
    fontWeight: "800",
  },
});
