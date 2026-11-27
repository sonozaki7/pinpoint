import handSvg from "./hand.svg?raw";
import type { Gesture } from "../sim/gestures";

const LABELS: Record<Gesture, string> = {
  up: "Slide up · scroll",
  down: "Slide down · scroll",
  tap: "Press · tap",
  double: "Press twice · double-tap, back",
  hold: "Press and hold · menu",
};

const PRESS = [
  { transform: "translate(0px, 0px) scale(1)" },
  { transform: "translate(-8px, 5px) scale(0.975)", offset: 0.4 },
  { transform: "translate(0px, 0px) scale(1)" },
];

/**
 * The drawn hand with the ring. Its thumb does what the real thumb does for
 * each control: slides along the ring to scroll, presses once to tap, presses
 * twice to double-tap, and presses and holds (with a soft glow) for the menu.
 */
export class Hand {
  private readonly thumb: SVGGElement;
  private readonly led: SVGElement;
  private readonly ledGlow: SVGElement;
  private readonly holdGlow: SVGElement;
  private readonly caption: HTMLElement;
  private captionTimer: ReturnType<typeof setTimeout> | undefined;
  private running: Animation[] = [];
  private pendingDouble: ReturnType<typeof setTimeout> | undefined;

  constructor(host: HTMLElement, caption: HTMLElement) {
    host.innerHTML = handSvg;
    const find = <T extends Element>(id: string): T => {
      const node = host.querySelector<T>(`#${id}`);
      if (!node) throw new Error(`hand.svg is missing #${id}`);
      return node;
    };
    this.thumb = find<SVGGElement>("hand-thumb");
    this.led = find("hand-led");
    this.ledGlow = find("hand-led-glow");
    this.holdGlow = find("hand-hold-glow");
    this.caption = caption;
    for (const node of [this.thumb, this.led, this.ledGlow, this.holdGlow]) {
      const style = (node as SVGElement).style;
      style.transformBox = "fill-box";
      style.transformOrigin = "center";
    }
    this.thumb.style.transformBox = "view-box";
    this.thumb.style.transformOrigin = "215px 150px";
  }

  private run(node: Element, keyframes: Keyframe[], duration: number, easing = "cubic-bezier(.3,.7,.2,1)"): Animation | null {
    if (typeof node.animate !== "function") return null;
    const animation = node.animate(keyframes, { duration, easing, fill: "none" });
    this.running.push(animation);
    animation.finished.finally(() => {
      this.running = this.running.filter((entry) => entry !== animation);
    }).catch(() => undefined);
    return animation;
  }

  private flashLed(strength = 1): void {
    this.run(this.led, [{ opacity: 1 }, { opacity: 1, transform: `scale(${1 + 0.5 * strength})` }, { opacity: 1 }], 320);
    this.run(this.ledGlow, [{ opacity: 0.7, transform: "scale(1)" }, { opacity: 1, transform: `scale(${1 + 0.9 * strength})` }, { opacity: 0.7, transform: "scale(1)" }], 360);
  }

  private say(gesture: Gesture): void {
    this.caption.textContent = LABELS[gesture];
    this.caption.classList.add("is-on");
    clearTimeout(this.captionTimer);
    this.captionTimer = setTimeout(() => this.caption.classList.remove("is-on"), 1_700);
  }

  play(gesture: Gesture): void {
    this.say(gesture);
    switch (gesture) {
      case "up":
      case "down": {
        const dy = gesture === "down" ? 30 : -30;
        const tilt = gesture === "down" ? 2.2 : -2.2;
        this.run(this.thumb, [
          { transform: "translate(0px, 0px) rotate(0deg)" },
          { transform: `translate(2px, ${dy}px) rotate(${tilt}deg)`, offset: 0.55 },
          { transform: "translate(0px, 0px) rotate(0deg)" },
        ], 380);
        this.flashLed(0.4);
        break;
      }
      case "tap":
        this.run(this.thumb, PRESS, 240);
        this.flashLed();
        break;
      case "double":
        this.run(this.thumb, PRESS, 200);
        this.flashLed();
        clearTimeout(this.pendingDouble);
        this.pendingDouble = setTimeout(() => {
          this.run(this.thumb, PRESS, 200);
          this.flashLed();
        }, 230);
        break;
      case "hold":
        this.run(this.thumb, [
          { transform: "translate(0px, 0px) scale(1)" },
          { transform: "translate(-8px, 5px) scale(0.975)", offset: 0.14 },
          { transform: "translate(-8px, 5px) scale(0.975)", offset: 0.86 },
          { transform: "translate(0px, 0px) scale(1)" },
        ], 900, "ease-in-out");
        this.run(this.holdGlow, [{ opacity: 0 }, { opacity: 1, offset: 0.25 }, { opacity: 1, offset: 0.8 }, { opacity: 0 }], 900, "ease-in-out");
        this.run(this.ledGlow, [{ opacity: 0.7, transform: "scale(1)" }, { opacity: 1, transform: "scale(2.6)", offset: 0.3 }, { opacity: 1, transform: "scale(2.2)", offset: 0.8 }, { opacity: 0.7, transform: "scale(1)" }], 900, "ease-in-out");
        break;
    }
  }
}
