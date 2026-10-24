import { EyeIcon, EyeOffIcon, SquareDashedIcon, Trash2Icon, Undo2Icon } from "lucide-react";
import { useRef, useState, type PointerEvent } from "react";
import { Button } from "@/ui/button";
import { cn } from "@/ui/cn";
import { Tooltip } from "@/ui/misc";

/** A rectangle in image fractions (0 to 1), so it survives any display size. */
export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

const MIN_BOX_FRACTION = 0.01;

function normalize(start: { x: number; y: number }, end: { x: number; y: number }): Box {
  return {
    x: Math.min(start.x, end.x),
    y: Math.min(start.y, end.y),
    width: Math.abs(end.x - start.x),
    height: Math.abs(end.y - start.y),
  };
}

/** Draws the boxes onto the full-resolution screenshot and returns a PNG data URL. */
export async function renderAnnotated(dataUrl: string, boxes: Box[]): Promise<string> {
  if (boxes.length === 0) return dataUrl;
  const image = new Image();
  image.src = dataUrl;
  await image.decode();
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const context = canvas.getContext("2d");
  if (!context) return dataUrl;
  context.drawImage(image, 0, 0);
  const stroke = Math.max(3, Math.round(canvas.width / 400));
  context.lineWidth = stroke;
  context.strokeStyle = "#ef4444";
  context.fillStyle = "rgba(239, 68, 68, 0.08)";
  for (const box of boxes) {
    const x = box.x * canvas.width;
    const y = box.y * canvas.height;
    const width = box.width * canvas.width;
    const height = box.height * canvas.height;
    context.fillRect(x, y, width, height);
    context.strokeRect(x, y, width, height);
  }
  return canvas.toDataURL("image/png");
}

export function ScreenshotCard({
  src,
  included,
  onIncludedChange,
  boxes,
  onBoxesChange,
}: {
  src: string;
  included: boolean;
  onIncludedChange: (included: boolean) => void;
  boxes: Box[];
  onBoxesChange: (boxes: Box[]) => void;
}) {
  const surface = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState<{ start: { x: number; y: number }; end: { x: number; y: number } } | null>(null);

  const point = (event: PointerEvent) => {
    const rect = surface.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return {
      x: Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height)),
    };
  };

  const finish = () => {
    if (draft) {
      const box = normalize(draft.start, draft.end);
      if (box.width > MIN_BOX_FRACTION && box.height > MIN_BOX_FRACTION) onBoxesChange([...boxes, box]);
    }
    setDraft(null);
  };

  const visibleBoxes = draft ? [...boxes, normalize(draft.start, draft.end)] : boxes;

  return (
    <div className="group/screenshot relative flex justify-center overflow-hidden rounded-lg border bg-muted">
      {/* The drawing surface wraps the image exactly, so box fractions map to image pixels. */}
      <div
        ref={surface}
        role="img"
        aria-label={included ? "Screenshot of the visible tab. Drag to outline an area." : "Screenshot left out"}
        className={cn("relative select-none", included ? "cursor-crosshair" : "opacity-40 grayscale")}
        onPointerDown={(event) => {
          if (!included || event.button !== 0) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          const start = point(event);
          setDraft({ start, end: start });
        }}
        onPointerMove={(event) => {
          if (draft) setDraft({ ...draft, end: point(event) });
        }}
        onPointerUp={finish}
        onPointerCancel={() => setDraft(null)}
      >
        <img src={src} alt="" draggable={false} className="block max-h-56 max-w-full" />
        {visibleBoxes.map((box, index) => (
          <span
            // Boxes are append-only and never reorder, so the index is stable.
            key={index}
            className="pointer-events-none absolute rounded-[2px] border-2 border-annotation bg-annotation/8"
            style={{
              left: `${box.x * 100}%`,
              top: `${box.y * 100}%`,
              width: `${box.width * 100}%`,
              height: `${box.height * 100}%`,
            }}
          />
        ))}
      </div>

      <div className="absolute inset-x-1.5 bottom-1.5 flex items-center justify-between gap-1">
        <span
          className={cn(
            "pointer-events-none inline-flex items-center gap-1 rounded-md bg-background/85 px-1.5 py-0.5 text-2xs text-muted-foreground backdrop-blur-sm transition-opacity",
            boxes.length > 0 || !included ? "opacity-100" : "opacity-0 group-hover/screenshot:opacity-100",
          )}
        >
          <SquareDashedIcon className="size-3" />
          {!included
            ? "Screenshot left out"
            : boxes.length > 0
              ? `${boxes.length} ${boxes.length === 1 ? "area" : "areas"} marked`
              : "Drag to mark an area"}
        </span>
        <span className="flex items-center gap-0.5 rounded-md bg-background/85 p-0.5 backdrop-blur-sm">
          {included && boxes.length > 0 ? (
            <>
              <Tooltip content="Undo last mark">
                <Button variant="ghost" size="icon-xs" aria-label="Undo last mark" onClick={() => onBoxesChange(boxes.slice(0, -1))}>
                  <Undo2Icon />
                </Button>
              </Tooltip>
              <Tooltip content="Clear marks">
                <Button variant="ghost" size="icon-xs" aria-label="Clear marks" onClick={() => onBoxesChange([])}>
                  <Trash2Icon />
                </Button>
              </Tooltip>
            </>
          ) : null}
          <Tooltip content={included ? "Leave out the screenshot" : "Include the screenshot"}>
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={included ? "Leave out the screenshot" : "Include the screenshot"}
              aria-pressed={!included}
              onClick={() => onIncludedChange(!included)}
            >
              {included ? <EyeOffIcon /> : <EyeIcon />}
            </Button>
          </Tooltip>
        </span>
      </div>
    </div>
  );
}
