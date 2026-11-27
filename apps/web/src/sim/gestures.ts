export type Gesture = "up" | "down" | "tap" | "double" | "hold";

const HOLD_MS = 560;
const TAP_DELAY_MS = 250;
const DOUBLE_MS = 360;
const DRAG_STEP = 28;
const WHEEL_STEP = 34;

/**
 * The physical ring, as a browser control. Wheel or drag vertically to scroll,
 * tap once, tap twice quickly, or press and hold. The ring's metal face turns a
 * little as it scrolls, and the button stays a normal focusable control.
 */
export class RingController {
  private readonly surface: HTMLElement;
  private readonly onGesture: (gesture: Gesture) => void;
  private holdTimer: ReturnType<typeof setTimeout> | undefined;
  private tapTimer: ReturnType<typeof setTimeout> | undefined;
  private lastTapAt = 0;
  private startX = 0;
  private startY = 0;
  private moved = false;
  private held = false;
  private activePointer: number | null = null;
  private wheelTotal = 0;
  private wheelLockedUntil = 0;
  private turn = 0;

  constructor(surface: HTMLElement, onGesture: (gesture: Gesture) => void) {
    this.surface = surface;
    this.onGesture = onGesture;
    surface.addEventListener("pointerdown", this.onPointerDown);
    surface.addEventListener("pointermove", this.onPointerMove);
    surface.addEventListener("pointerup", this.onPointerUp);
    surface.addEventListener("pointercancel", this.onPointerCancel);
    surface.addEventListener("wheel", this.onWheel, { passive: false });
    surface.addEventListener("contextmenu", (event) => event.preventDefault());
    surface.addEventListener("keydown", this.onKeyDown);
  }

  private pulse(direction: Gesture): void {
    this.surface.dataset.last = direction;
    window.setTimeout(() => {
      if (this.surface.dataset.last === direction) delete this.surface.dataset.last;
    }, 220);
  }

  private scroll(direction: "up" | "down"): void {
    const now = performance.now();
    if (now < this.wheelLockedUntil) return;
    this.wheelLockedUntil = now + 130;
    this.turn += direction === "down" ? 17 : -17;
    this.turn = Math.max(-140, Math.min(140, this.turn));
    this.surface.style.setProperty("--ring-turn", `${this.turn}deg`);
    this.pulse(direction === "down" ? "down" : "up");
    this.onGesture(direction);
  }

  private onWheel = (event: WheelEvent): void => {
    event.preventDefault();
    const delta = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaY;
    this.wheelTotal += delta;
    if (Math.abs(this.wheelTotal) < WHEEL_STEP) return;
    const direction = this.wheelTotal > 0 ? "down" : "up";
    this.wheelTotal = 0;
    this.scroll(direction);
  };

  private onPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0 && event.pointerType === "mouse") return;
    if (this.activePointer !== null) return;
    this.activePointer = event.pointerId;
    this.surface.setPointerCapture(event.pointerId);
    this.startX = event.clientX;
    this.startY = event.clientY;
    this.moved = false;
    this.held = false;
    this.surface.classList.add("is-pressed");
    clearTimeout(this.holdTimer);
    this.holdTimer = setTimeout(() => {
      this.held = true;
      this.surface.classList.add("is-held");
      this.onGesture("hold");
    }, HOLD_MS);
  };

  private onPointerMove = (event: PointerEvent): void => {
    if (event.pointerId !== this.activePointer || this.held) return;
    const dx = event.clientX - this.startX;
    const dy = event.clientY - this.startY;
    if (Math.abs(dx) > 8 || Math.abs(dy) > 8) {
      clearTimeout(this.holdTimer);
      this.surface.classList.remove("is-pressed");
    }
    if (Math.abs(dy) < DRAG_STEP) return;
    const direction = dy > 0 ? "down" : "up";
    this.startY = event.clientY;
    this.startX = event.clientX;
    this.moved = true;
    this.scroll(direction);
  };

  private onPointerUp = (event: PointerEvent): void => {
    if (event.pointerId !== this.activePointer) return;
    this.endPointer();
    if (this.held || this.moved) return;
    this.queueTap();
  };

  private onPointerCancel = (event: PointerEvent): void => {
    if (event.pointerId !== this.activePointer) return;
    this.endPointer();
  };

  private endPointer(): void {
    clearTimeout(this.holdTimer);
    this.holdTimer = undefined;
    this.activePointer = null;
    this.surface.classList.remove("is-pressed", "is-held");
  }

  private queueTap(): void {
    const now = performance.now();
    if (now - this.lastTapAt <= DOUBLE_MS) {
      clearTimeout(this.tapTimer);
      this.tapTimer = undefined;
      this.lastTapAt = 0;
      this.pulse("double");
      this.onGesture("double");
      return;
    }
    this.lastTapAt = now;
    clearTimeout(this.tapTimer);
    this.tapTimer = setTimeout(() => {
      this.tapTimer = undefined;
      this.lastTapAt = 0;
      this.pulse("tap");
      this.onGesture("tap");
    }, TAP_DELAY_MS);
  }

  private onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === " " || event.key === "Spacebar") {
      event.preventDefault();
      event.stopPropagation();
      this.queueTap();
    }
  };
}
