import { OsEventTypeList, type EvenHubEvent } from "@evenrealities/even_hub_sdk";

export type Input =
  | { kind: "tap"; listIndex?: number; fromList?: boolean }
  | { kind: "double" }
  | { kind: "up"; listIndex?: number; fromList?: boolean }
  | { kind: "down"; listIndex?: number; fromList?: boolean }
  | { kind: "menu"; id: number }
  | { kind: "audio"; pcm: Uint8Array }
  | { kind: "surface"; enter: boolean }
  | { kind: "hold"; phase: "start" | "release" }
  | { kind: "exit"; reason: number; abnormal: boolean }
  /** The glasses went on (true) or off (false) the head: DeviceStatus.isWearing. */
  | { kind: "wear"; worn: boolean };

/**
 * Normalize the three envelopes the SDK can use for one gesture.
 *
 * Protobuf omits the numeric zero used for CLICK, so a bare envelope is a tap.
 * That default applies inside each envelope, exactly as the official ASR
 * template does; it must not depend on `eventSource`, because the host omits
 * that field on some taps (and always on the long-press pair). A handler that
 * required a touch source would silently drop every tap from such a host.
 *
 * A list click may also omit `currentSelectItemIndex` for the first row. The
 * documented default is row 0, so a missing index never opens a stale row.
 */
export function decodeInput(event: EvenHubEvent): Input | undefined {
  const menuId = event.menuItemClickEvent?.itemID;
  if (typeof menuId === "number" && menuId > 0) return { kind: "menu", id: menuId };

  const pcm = event.audioEvent?.audioPcm;
  if (pcm && pcm.length > 0) return { kind: "audio", pcm };

  const list = event.listEvent;
  const text = event.textEvent;
  const sys = event.sysEvent;

  let type: OsEventTypeList | undefined;
  let listIndex: number | undefined;
  let fromList = false;
  if (list) {
    type = list.eventType ?? OsEventTypeList.CLICK_EVENT;
    fromList = true;
    listIndex = typeof list.currentSelectItemIndex === "number"
      ? list.currentSelectItemIndex
      : 0;
  } else if (text) {
    type = text.eventType ?? OsEventTypeList.CLICK_EVENT;
  } else if (sys) {
    type = sys.eventType ?? OsEventTypeList.CLICK_EVENT;
  } else {
    return undefined;
  }

  switch (type) {
    case OsEventTypeList.CLICK_EVENT:
      return fromList ? { kind: "tap", listIndex, fromList } : { kind: "tap", listIndex };
    case OsEventTypeList.SCROLL_TOP_EVENT:
      return fromList ? { kind: "up", listIndex, fromList } : { kind: "up", listIndex };
    case OsEventTypeList.SCROLL_BOTTOM_EVENT:
      return fromList ? { kind: "down", listIndex, fromList } : { kind: "down", listIndex };
    case OsEventTypeList.DOUBLE_CLICK_EVENT:
      return { kind: "double" };
    case OsEventTypeList.FOREGROUND_ENTER_EVENT:
      return { kind: "surface", enter: true };
    case OsEventTypeList.FOREGROUND_EXIT_EVENT:
      return { kind: "surface", enter: false };
    case OsEventTypeList.LONG_PRESS_EVENT:
      return { kind: "hold", phase: "start" };
    case OsEventTypeList.LONG_PRESS_RELEASE_EVENT:
      return { kind: "hold", phase: "release" };
    case OsEventTypeList.SYSTEM_EXIT_EVENT:
      return { kind: "exit", reason: sys?.systemExitReasonCode ?? 0, abnormal: false };
    case OsEventTypeList.ABNORMAL_EXIT_EVENT:
      return { kind: "exit", reason: sys?.systemExitReasonCode ?? 0, abnormal: true };
    default:
      return undefined;
  }
}
