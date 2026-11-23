import {
  AudioInputSource,
  CreateStartUpPageContainer,
  ListContainerProperty,
  ListItemContainerProperty,
  MenuContainerProperty,
  MenuItemProperty,
  RebuildPageContainer,
  StartUpPageCreateResult,
  TextContainerProperty,
  TextContainerUpgrade,
  waitForEvenAppBridge,
} from "@evenrealities/even_hub_sdk";
import type { PageModel } from "./display";
import { decodeInput, type Input } from "./events";

export interface TextBox {
  name: string;
  id: number;
  content: string;
  brightness: number;
  x: number;
  y: number;
  width: number;
  height: number;
  capture?: boolean;
  border?: boolean;
  padding?: number;
}

export interface PageLayout {
  text: TextBox[];
  list?: { items: string[] };
}

const CAPTURE: Omit<TextBox, "id"> = {
  name: "capture", content: " ", brightness: 1, x: 0, y: 0, width: 576, height: 288, capture: true,
};

function header(page: PageModel, id: number, y = 6, height = 28): TextBox {
  const content = page.subtitle ? `${page.title}\n${page.subtitle}` : page.title;
  return { name: "header", id, content, brightness: 3, x: 16, y, width: 544, height };
}

export function layoutFor(page: PageModel): PageLayout {
  if (page.kind === "inbox") {
    if (page.list) {
      return {
        text: [
          header(page, 1, 8, 56),
          { name: "footer", id: 3, content: page.footer, brightness: 2, x: 16, y: 252, width: 544, height: 30 },
        ],
        list: { items: page.list },
      };
    }
    return {
      text: [
        { ...CAPTURE, id: 1 },
        header(page, 2, 8, 56),
        {
          name: "message", id: 3, content: page.message ?? "", brightness: 3,
          x: 20, y: 96, width: 536, height: 128, border: true,
        },
        { name: "footer", id: 4, content: page.footer, brightness: 2, x: 16, y: 252, width: 544, height: 30 },
      ],
    };
  }

  if (page.kind === "review") {
    const boxes: TextBox[] = [
      { ...CAPTURE, id: 1 },
      header(page, 2, 4),
    ];
    page.rows.forEach((row, index) => {
      boxes.push({
        name: `row${index + 1}`, id: 3 + index, content: row.text, brightness: row.brightness,
        x: 18, y: 38 + index * 29, width: 540, height: 28,
      });
    });
    const paneId = 3 + page.rows.length;
    boxes.push({
      name: "pane", id: paneId, content: page.pane ?? "", brightness: 2,
      x: 18, y: 157, width: 540, height: 86, border: true, padding: 2,
    });
    boxes.push({
      name: "footer", id: paneId + 1, content: page.footer, brightness: 2,
      x: 18, y: 250, width: 540, height: 30,
    });
    return { text: boxes };
  }

  if (page.kind === "options") {
    const boxes: TextBox[] = [
      { ...CAPTURE, id: 1 },
      header(page, 2, 6),
    ];
    page.rows.forEach((row, index) => {
      boxes.push({
        name: `opt${index + 1}`, id: 3 + index, content: row.text, brightness: row.brightness,
        x: 18, y: 42 + index * 31, width: 540, height: 29,
      });
    });
    boxes.push({
      name: "footer", id: 3 + page.rows.length, content: page.footer, brightness: 2,
      x: 18, y: 250, width: 540, height: 30,
    });
    return { text: boxes };
  }

  return {
    text: [
      { ...CAPTURE, id: 1 },
      header(page, 2, 44),
      {
        name: "pane", id: 3, content: page.pane ?? "", brightness: 4,
        x: 36, y: 88, width: 504, height: 84,
      },
      { name: "footer", id: 4, content: page.footer, brightness: 2, x: 16, y: 236, width: 544, height: 30 },
    ],
  };
}

function toTextContainers(boxes: readonly TextBox[]): TextContainerProperty[] {
  return boxes.map((box) => new TextContainerProperty({
    xPosition: box.x,
    yPosition: box.y,
    width: box.width,
    height: box.height,
    containerID: box.id,
    containerName: box.name,
    content: box.content,
    isEventCapture: box.capture ? 1 : 0,
    borderWidth: box.border ? 1 : 0,
    borderColor: 4,
    paddingLength: box.padding ?? (box.border ? 6 : 0),
    textColor: box.brightness,
  }));
}

function toMenu(page: PageModel): MenuContainerProperty | undefined {
  if (page.menu.length === 0) return undefined;
  return new MenuContainerProperty({
    menuItems: page.menu.map((item) => new MenuItemProperty({ itemName: item.label, itemID: item.id })),
  });
}

function toList(page: PageModel): ListContainerProperty[] {
  if (!page.list) return [];
  return [new ListContainerProperty({
    xPosition: 16,
    yPosition: 70,
    width: 544,
    height: 174,
    containerID: 2,
    containerName: "list",
    isEventCapture: 1,
    borderWidth: 0,
    paddingLength: 0,
    itemContainer: new ListItemContainerProperty({
      itemCount: page.list.length,
      itemWidth: 500,
      isItemSelectBorderEn: 1,
      itemName: page.list,
    }),
  })];
}

export function createLayout(page: PageModel): CreateStartUpPageContainer {
  const layout = layoutFor(page);
  const text = toTextContainers(layout.text);
  const list = toList(page);
  return new CreateStartUpPageContainer({
    containerTotalNum: text.length + list.length,
    textObject: text,
    listObject: list,
    menuObject: toMenu(page),
  });
}

export function rebuildLayout(page: PageModel): RebuildPageContainer {
  const layout = layoutFor(page);
  const text = toTextContainers(layout.text);
  const list = toList(page);
  return new RebuildPageContainer({
    containerTotalNum: text.length + list.length,
    textObject: text,
    listObject: list,
    menuObject: toMenu(page),
  });
}

function shapeOf(page: PageModel): string {
  const shape = page.list
    ? `list${page.list.length}`
    : page.message !== undefined
      ? `message${page.message.length}`
      : `rows${page.rows.length}`;
  return `${page.kind}:${shape}`;
}

function fullSignature(page: PageModel): string {
  return [
    shapeOf(page),
    page.title,
    page.subtitle ?? "",
    page.list?.join("\u0001") ?? "",
    page.message ?? "",
    page.rows.map((row) => `${row.brightness}:${row.text}`).join("\u0001"),
    page.pane ?? "",
    page.footer,
    page.menu.map((item) => `${item.id}:${item.label}`).join("\u0001"),
  ].join("\u0002");
}

function signature(box: TextBox): string {
  return `${box.brightness}\u0000${box.content}`;
}

/**
 * One bridge write at a time. The SDK transport is asynchronous and the page
 * can change while a rebuild is in flight, so overlapping calls can interleave
 * with containers being replaced. A failed write must not stall the writes
 * behind it.
 */
export class SerialWrites {
  private tail: Promise<unknown> = Promise.resolve();

  run<T>(task: () => Promise<T>): Promise<T> {
    const result = this.tail.then(task, task);
    this.tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}

export async function connectEven(
  getPage: () => PageModel,
  onInput: (input: Input) => void,
  setHostStatus: (message: string) => void,
) {
  const bridge = await waitForEvenAppBridge();
  const initial = getPage();
  const result = await bridge.createStartUpPageContainer(createLayout(initial));
  if (result !== StartUpPageCreateResult.success) {
    throw new Error("Even Hub rejected the initial display");
  }
  let shape = shapeOf(initial);
  let full = fullSignature(initial);
  let signatures = new Map(layoutFor(initial).text.map((box) => [box.name, signature(box)]));

  const unsubscribe = bridge.onEvenHubEvent((event) => {
    const input = decodeInput(event);
    if (input) onInput(input);
  });
  window.addEventListener("pagehide", (event) => { if (!event.persisted) unsubscribe(); });
  const connected = "Glasses connected";
  setHostStatus(connected);
  console.info("[pinpoint] ready");

  const writes = new SerialWrites();

  async function apply(page: PageModel) {
    const nextFull = fullSignature(page);
    if (nextFull === full) return;
    const nextShape = shapeOf(page);
    const layout = layoutFor(page);
    if (nextShape !== shape || page.kind === "inbox") {
      const ok = await bridge.rebuildPageContainer(rebuildLayout(page));
      if (!ok) throw new Error("Even Hub rejected the page rebuild");
      shape = nextShape;
      full = nextFull;
      signatures = new Map(layout.text.map((box) => [box.name, signature(box)]));
      return;
    }
    for (const box of layout.text) {
      const next = signature(box);
      if (signatures.get(box.name) === next) continue;
      const ok = await bridge.textContainerUpgrade(new TextContainerUpgrade({
        containerID: box.id,
        containerName: box.name,
        content: box.content,
        textColor: box.brightness,
      }));
      if (!ok) throw new Error(`Even Hub rejected ${box.name}`);
      signatures.set(box.name, next);
    }
    full = nextFull;
  }

  return {
    render(page: PageModel) {
      return writes.run(() => apply(page)).catch((error) => {
        console.error("[pinpoint] display", error);
        setHostStatus("Even Hub display update failed");
      });
    },
    async exit() {
      await writes.run(async () => {
        try {
          if (!await bridge.shutDownPageContainer(1)) setHostStatus("Even Hub exit could not open");
        } catch {
          setHostStatus("Even Hub exit could not open");
        }
      });
    },
    async mic(on: boolean) {
      try {
        return await bridge.audioControl(on, on ? AudioInputSource.Glasses : undefined);
      } catch {
        return false;
      }
    },
  };
}
