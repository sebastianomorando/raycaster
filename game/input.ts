import type { Camera } from "./camera.ts";

export type InputAction =
  | { kind: "move"; relativeDirection: number }
  | { kind: "turn"; amount: -1 | 1 }
  | { kind: "wait" };

export type InputBindings = Readonly<{
  frame: HTMLElement;
  inventoryPanel: HTMLElement;
  resolutionButton: HTMLButtonElement;
  camera: Camera;
  lookSensitivity: number;
  maxLookPitch: number;
  minFov: number;
  maxFov: number;
  zoomSensitivity: number;
  isInventoryOpen(): boolean;
  canStartLook(): boolean;
  onLookStart(): void;
  onCameraChanged(): void;
  onAction(action: InputAction): void;
  onInventory(open: boolean): void;
  onInventorySlot(index: number): void;
  onRestart(): void;
  onTogglePause(): void;
  onResize(): void;
  onCycleResolution(): void;
}>;

const HANDLED_KEYS = new Set([
  "KeyW", "KeyS", "KeyA", "KeyD", "KeyQ", "KeyE",
  "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "KeyR", "KeyI",
  "KeyP", "Space", "Period", "Escape",
  "Digit1", "Digit2", "Digit3", "Digit4", "Digit5", "Digit6", "Digit7", "Digit8",
]);

/** Collega mouse, rotellina e tastiera alle intenzioni del gioco. */
export class GameInputController {
  private pointerId: number | null = null;
  private lastX = 0;
  private lastY = 0;

  constructor(private readonly bindings: InputBindings) {
    bindings.frame.addEventListener("pointerdown", this.pointerDown);
    bindings.frame.addEventListener("pointermove", this.pointerMove);
    bindings.frame.addEventListener("pointerup", this.finishMouseLook);
    bindings.frame.addEventListener("pointercancel", this.finishMouseLook);
    bindings.frame.addEventListener("lostpointercapture", this.finishMouseLook);
    bindings.frame.addEventListener("wheel", this.wheel, { passive: false });
    bindings.inventoryPanel.addEventListener("pointerdown", this.stopPropagation);
    bindings.resolutionButton.addEventListener("click", bindings.onCycleResolution);
    window.addEventListener("keydown", this.keyDown);
    window.addEventListener("resize", bindings.onResize);
  }

  get isLooking(): boolean {
    return this.pointerId !== null;
  }

  private readonly stopPropagation = (event: Event): void => event.stopPropagation();

  private readonly pointerDown = (event: PointerEvent): void => {
    const { bindings } = this;
    if (
      bindings.isInventoryOpen() || event.button !== 0 ||
      this.pointerId !== null || !bindings.canStartLook()
    ) return;
    event.preventDefault();
    this.pointerId = event.pointerId;
    this.lastX = event.clientX;
    this.lastY = event.clientY;
    bindings.onLookStart();
    bindings.frame.classList.add("looking");
    bindings.frame.setPointerCapture(event.pointerId);
  };

  private readonly pointerMove = (event: PointerEvent): void => {
    if (event.pointerId !== this.pointerId) return;
    const { bindings } = this;
    const movementX = event.clientX - this.lastX;
    const movementY = event.clientY - this.lastY;
    this.lastX = event.clientX;
    this.lastY = event.clientY;
    bindings.camera.yaw += movementX * bindings.lookSensitivity;
    bindings.camera.pitch = Math.max(
      -bindings.maxLookPitch,
      Math.min(
        bindings.maxLookPitch,
        bindings.camera.pitch - movementY * bindings.lookSensitivity,
      ),
    );
    bindings.onCameraChanged();
  };

  private readonly finishMouseLook = (event: PointerEvent): void => {
    if (event.pointerId !== this.pointerId) return;
    this.pointerId = null;
    this.bindings.frame.classList.remove("looking");
    if (this.bindings.frame.hasPointerCapture(event.pointerId)) {
      this.bindings.frame.releasePointerCapture(event.pointerId);
    }
  };

  private readonly wheel = (event: WheelEvent): void => {
    event.preventDefault();
    const { bindings } = this;
    if (bindings.isInventoryOpen()) return;
    bindings.onLookStart();
    bindings.camera.fov = Math.max(
      bindings.minFov,
      Math.min(bindings.maxFov, bindings.camera.fov + event.deltaY * bindings.zoomSensitivity),
    );
    bindings.onCameraChanged();
  };

  private readonly keyDown = (event: KeyboardEvent): void => {
    if (HANDLED_KEYS.has(event.code)) event.preventDefault();
    if (event.repeat) return;
    const { bindings } = this;

    if (event.code === "KeyR") {
      bindings.onRestart();
      return;
    }

    const digitMatch = /^Digit([1-8])$/.exec(event.code);
    if (bindings.isInventoryOpen()) {
      if (event.code === "KeyI" || event.code === "Escape") bindings.onInventory(false);
      if (digitMatch) bindings.onInventorySlot(Number(digitMatch[1]) - 1);
      return;
    }

    if (event.code === "KeyI") {
      bindings.onInventory(true);
      return;
    }
    if (event.code === "KeyW" || event.code === "ArrowUp") {
      bindings.onAction({ kind: "move", relativeDirection: 0 });
    }
    if (event.code === "KeyS" || event.code === "ArrowDown") {
      bindings.onAction({ kind: "move", relativeDirection: 2 });
    }
    if (event.code === "KeyQ") bindings.onAction({ kind: "move", relativeDirection: -1 });
    if (event.code === "KeyE") bindings.onAction({ kind: "move", relativeDirection: 1 });
    if (event.code === "KeyA" || event.code === "ArrowLeft") {
      bindings.onAction({ kind: "turn", amount: -1 });
    }
    if (event.code === "KeyD" || event.code === "ArrowRight") {
      bindings.onAction({ kind: "turn", amount: 1 });
    }
    if (event.code === "Space" || event.code === "Period") bindings.onAction({ kind: "wait" });
    if (event.code === "KeyP") bindings.onTogglePause();
  };
}
