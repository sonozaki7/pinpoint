import { CLOUD_URL } from "../../../../shared/contract";
import { HttpPinpointApi } from "../../../glasses/src/api";
import { MockPinpointApi } from "../../../glasses/src/mock";
import type { SamplePersona } from "../../../glasses/src/model";

/**
 * The browser's sample workspace. Everything the glasses do with their offline
 * demo (inbox, decks, "Since you looked", Ask, edits, New task) comes from the
 * real mock in apps/glasses, which in turn runs shared/edit.ts and
 * shared/ask.ts. The only thing added here is the voice: the microphone goes to
 * Pinpoint Cloud's /api/voice (the same call the glasses make) and the words
 * come back as text.
 */
export class WebApi extends MockPinpointApi {
  private readonly cloud = new HttpPinpointApi(CLOUD_URL, { sample: "mixed" });

  constructor(persona: SamplePersona = "developer") {
    super({ extended: true, sample: true, persona });
  }

  /** Real transcription only. A failure is the caller's cue to offer "Type instead". */
  override async voice(
    pcm?: Uint8Array,
    _context?: { threadId: string; pointId?: string },
    _purpose: "note" | "ask" | "task" = "note",
  ): Promise<{ text: string; verdict?: "object" | "note" }> {
    if (!pcm || pcm.length < 6_400) throw new Error("No speech captured");
    const result = await this.cloud.voice(pcm);
    if (!result.text.trim()) throw new Error("Nothing was heard");
    return result;
  }

  /** A believable sentence for this moment, offered as the starting text when typing instead. */
  async suggest(
    context: { threadId: string; pointId?: string } | undefined,
    purpose: "note" | "ask" | "task",
  ): Promise<string> {
    const result = await super.voice(undefined, context, purpose);
    return result.text;
  }
}
