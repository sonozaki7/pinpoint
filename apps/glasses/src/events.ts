import { EventSourceType, OsEventTypeList, type EvenHubEvent } from "@evenrealities/even_hub_sdk";

export type Input =
  | { kind: "tap"; listIndex?: number }
  | { kind: "double" }
  | { kind: "up"; listIndex?: number }
  | { kind: "down"; listIndex?: number }
  | { kind: "menu"; id: number }
  | { kind: "audio"; pcm: Uint8Array }
  | { kind: "surface"; enter: boolean };

/**
 * Normalize the three envelopes the SDK can use for one gesture. Hosts omit the
 * numeric zero used for CLICK, so an empty envelope with a touch source is a tap.
 */
export function decodeInput(event: EvenHubEvent): Input | undefined {
  const menuId = event.menuItemClickEvent?.itemID;
  if (typeof menuId === "number" && menuId > 0) return { kind: "menu", id: menuId };

  const pcm = event.audioEvent?.audioPcm;
  if (pcm && pcm.length > 0) return { kind: "audio", pcm };

  const list = event.listEvent;
  const text = event.textEvent;
  const sys = event.sysEvent;
  const fromTouch = sys?.eventSource === EventSourceType.TOUCH_EVENT_FROM_GLASSES_R ||
    sys?.eventSource === EventSourceType.TOUCH_EVENT_FROM_GLASSES_L ||
    sys?.eventSource === EventSourceType.TOUCH_EVENT_FROM_RING;

  let type: OsEventTypeList | undefined;
  let listIndex: number | undefined;
  if (list) {
    type = list.eventType ?? OsEventTypeList.CLICK_EVENT;
    if (typeof list.currentSelectItemIndex === "number") listIndex = list.currentSelectItemIndex;
  } else if (text) {
    type = text.eventType ?? OsEventTypeList.CLICK_EVENT;
  } else if (sys) {
    type = sys.eventType ?? (fromTouch ? OsEventTypeList.CLICK_EVENT : undefined);
  } else {
    return undefined;
  }

  switch (type) {
    case OsEventTypeList.CLICK_EVENT:
      return { kind: "tap", listIndex };
    case OsEventTypeList.SCROLL_TOP_EVENT:
      return { kind: "up", listIndex };
    case OsEventTypeList.SCROLL_BOTTOM_EVENT:
      return { kind: "down", listIndex };
    case OsEventTypeList.DOUBLE_CLICK_EVENT:
      return { kind: "double" };
    case OsEventTypeList.FOREGROUND_ENTER_EVENT:
      return { kind: "surface", enter: true };
    case OsEventTypeList.FOREGROUND_EXIT_EVENT:
      return { kind: "surface", enter: false };
    default:
      return undefined;
  }
}
