# What the hosts said (mid-hackathon Q&A, Nov 25 2026) and what we do about it

Source: the owner's recording of the Even Realities × TVM Ventures Q&A (≈40 min, transcribed locally), plus the organizers' Day-1 message and track brief. Paraphrased; short quotes are verbatim.

| Host advice | What it means for Pinpoint |
|---|---|
| Main track: "build your core integration on its apps: they all have open APIs, so every team can build a real, working integration." Track 04 apps: Claude, ChatGPT, OpenRouter, Notion, Google Workspace (Gmail, Calendar, Drive). | T3 Code is not a track app. The core integration for AI Assistants & Work must be Gmail, Calendar, Notion and an LLM via OpenRouter. T3 Code stays as the reason the owner built it (it runs Claude Code and Codex agents). |
| Second track allowed "if your app genuinely connects apps from several tracks". Max two. "Some people implement parts from three tracks." | Main: AI Assistants & Work. Second: Messaging & News (Telegram first, Slack/Discord adapters). Also eligible for Best Telegram integration. |
| "If you include Telegram, then you can do a lot more wider use cases and that's kind of our catch-all category." | Telegram stays central: alerts, the deep-read companion, reply drafts, receipts. |
| "What makes glasses special: you reply on Telegram, check your wallet and catch the news without ever pulling out your phone. Build for that." | The hero flow never needs the phone: review, correct by voice, send, see the receipt on the glasses. |
| Read & write (25%): "is it overcrowded with words and symbols and you can't see properly, or is it well polished?" | Fewer symbols on the glasses. Words over glyphs. One idea per line. |
| UX (15%) is about a good experience, not guideline compliance. "Tap and ring count as hands-free." | R1 ring + voice is the right input model. |
| "We really look at how production-ready your app is … built the infrastructure so users can come in and use it … ready as an application or a real path towards being completed." Polish one build. | Pinpoint Cloud (works on any G2 out of the box), real connectors, web simulator, docs, privacy. |
| Business (10%, TVM): "engage a large number of users because it's very easy to use, or provide real value to a niche group"; "$3 subscription … 2,000 people … $6,000 per month." | README/submission state the business model: free sample, paid Pinpoint Pro (connectors, desk pairing), team plan; who pays and why. |
| Video: 1–3 minutes, "try to make it dense", they may watch it several times; the video is the preliminary view of every app. | ≤ 2:30, dense but simple, captions burned in. |
| Judges run entries "on real glasses or in the simulator … depends how far the app makes it". | Real-G2 readiness + a browser simulator anyone can try. |
| Companion apps/backends are fine; "a lot of people use desktop apps, which I think is a little bit of a cleaner workflow"; many use Tailscale. | Desk app (server on your computer) + cloud relay, so no Tailscale needed. |
| Long press and double tap reach the app; root double tap is reserved for the exit dialog. The app keeps network and display while the phone is locked; the OS may still kill it. | Matches docs/device-readiness.md; keep exit handling and resume repaint. |
| Display updates: "at least four to five frames within a second"; faster makes Bluetooth unreliable. | Never animate; update on input only; recording timer ≤ 1 update/s. |
| Mic PCM can stay open as long as needed. Bring your own STT (Deepgram suggested). | Whisper on our server; T3's local model on the desk. |
| Hub app icon must be 24×24 pixel art; upload mechanism exists. | Make a 24×24 1-bit icon from the reticle mark. |
| In-app contextual menu: max 10 items. | Keep the hold menu short. |
| They like "the more ambitious stuff people are doing in AI agents and in messaging and really adding real function to the device." | Our lane. |
| AI Assistants and Exchanges are "wide open"; Messaging and Crypto are packed. | Lead with AI Assistants & Work. |
