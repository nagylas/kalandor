import type { Segment } from "./plannerTypes";
import {
    formatSegmentDuration,
    segmentCardColors,
    segmentDurationMinutes,
    segmentTypeLabel,
} from "./plannerUtils";

const BLOCK_MINUTES = 15;
const BLOCK_HEIGHT = 18;
const PX_PER_MINUTE = BLOCK_HEIGHT / BLOCK_MINUTES;

export function DaySegmentList({
  segments,
  draggingSegmentId,
  onDelete,
  onEdit,
  onDragStateChange,
  onDropSegmentToList,
}: {
  segments: Segment[];
  draggingSegmentId: string | null;
  onDelete: (segment: Segment) => void;
  onEdit: (segment: Segment) => void;
  onDragStateChange: (segmentId: string | null) => void;
  onDropSegmentToList: (segmentId: string) => void;
}) {
  return (
    <div
      onDragOver={(event) => {
        event.preventDefault();
      }}
      onDrop={(event) => {
        event.preventDefault();
        const segmentId = event.dataTransfer.getData(
          "application/x-kalandor-segment",
        );
        if (segmentId) {
          onDropSegmentToList(segmentId);
        }
      }}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 12,
        minHeight: 0,
        height: "100%",
        borderRadius: 12,
        border: "1px dashed rgba(255,255,255,0.18)",
        padding: 10,
        boxSizing: "border-box",
        overflowY: "auto",
        overflowX: "hidden",
      }}
    >
      {segments.map((segment) => {
        const durationMinutes = segmentDurationMinutes(segment);
        const isDragging = draggingSegmentId === segment.id;
        const colors = segmentCardColors(segment);

        return (
          <div
            key={segment.id}
            draggable
            onDragStart={(event) => {
              event.dataTransfer.effectAllowed = "move";
              event.dataTransfer.setData(
                "application/x-kalandor-segment",
                segment.id,
              );
              onDragStateChange(segment.id);
            }}
            onDragEnd={() => onDragStateChange(null)}
            style={{
              minHeight: Math.max(durationMinutes * PX_PER_MINUTE, 60),
              borderRadius: 12,
              border: `1px solid ${colors.border}`,
              background: colors.background,
              padding: "10px 12px",
              display: "flex",
              flexDirection: "column",
              gap: 6,
              cursor: "grab",
              opacity: isDragging ? 0.45 : 1,
              boxSizing: "border-box",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "flex-start",
                gap: 8,
              }}
            >
              <div
                style={{
                  fontSize: "0.86rem",
                  fontWeight: 700,
                  color: "#ffffff",
                }}
              >
                {segment.activityDescription} - {segmentTypeLabel(segment)}
              </div>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                }}
              >
                <button
                  type="button"
                  title="Edit segment"
                  onClick={() => onEdit(segment)}
                  style={{
                    background: "transparent",
                    border: "none",
                    color: "#bfdbfe",
                    cursor: "pointer",
                    fontWeight: 700,
                    padding: 0,
                    lineHeight: 1,
                  }}
                >
                  Edit
                </button>
                <button
                  type="button"
                  title="Remove segment"
                  onClick={() => onDelete(segment)}
                  style={{
                    background: "transparent",
                    border: "none",
                    color: "#fecaca",
                    cursor: "pointer",
                    fontWeight: 700,
                    padding: 0,
                    lineHeight: 1,
                  }}
                >
                  X
                </button>
              </div>
            </div>
            <div style={{ fontSize: "0.72rem", color: "#ffffff" }}>
              {formatSegmentDuration(durationMinutes)}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default DaySegmentList;
