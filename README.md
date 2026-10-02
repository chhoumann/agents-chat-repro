# Repro: a chat reply is lost when the socket closes mid-stream

This app is a plain `AIChatAgent` and a plain `useAgentChat` page. The agent streams a scripted reply, `REPLY to <your text> w1 ... w9 END`, one word every 500 ms (about 7 s). It calls no model.

`repro.ts` drives the page with Playwright. Each scenario kills the page's WebSocket in the middle of a reply, the way iOS does to a backgrounded PWA. It keeps reconnects failing for a while, then lets PartySocket reconnect on its own. It then checks the screen and the stored transcript (`/get-messages`), before and after a follow-up message.

Versions: `agents@0.26.0`, `@cloudflare/ai-chat@0.12.1`, `ai@6.0.219`. The same failures occur on `agents@0.17.4` with `@cloudflare/ai-chat@0.9.3`.

## Run the scenarios

1. Install the dependencies and a browser:

	```sh
	bun install
	bunx playwright install chromium
	```

2. Start the app:

	```sh
	bunx vite dev --port 3520
	```

3. In a second terminal, run the scenarios:

	```sh
	bun repro.ts
	```

To run one scenario, name it: `bun repro.ts down-until-done`. To use an installed Chrome, set `CHROME=/usr/bin/google-chrome`.

## The scenarios

`down-until-done` closes the socket after the first words arrive and keeps it closed until the reply has finished. This is the backgrounded phone.

`back-mid-stream` closes the socket after the first words arrive and lets it reconnect 500 ms later, while the reply is still streaming. This is a network blip.

## The two variants

By default, `onChatMessage` writes no `start` chunk, so the client keeps its own id for the reply. With `START=1`, it first writes `{ type: "start" }`, which the SDK stamps with the reply's stored id, so the client and the server agree on the id.

| Scenario | Default | `START=1` |
|---|---|---|
| `down-until-done` | The full reply never shows. The follow-up stores the cut-off copy as a second reply. | The full reply never shows. The follow-up overwrites the stored reply with the cut-off copy. |
| `back-mid-stream` | The reply's text shows twice. The follow-up stores a second reply with the doubled text. | Passes. |

Expected output for `START=1 bun repro.ts down-until-done`:

```
FAIL  down-until-done: after reconnect the full reply is on screen  -- "assistant: REPLY to first-a-... "
FAIL  down-until-done: after the follow-up the first reply is complete on screen  -- "assistant: REPLY to first-a-... "
FAIL  down-until-done: after the follow-up the first reply is stored complete  -- "REPLY to first-a-... "
```

## Try the proposed fix

The fix has two halves.

- The client half releases the streaming-reply protection when the socket closes. `client-fix.patch` is the change against `packages/agents/src/chat/react.tsx` on `main`. `apply-client-fix.ts` makes the same change in the installed `node_modules/agents/dist/chat/react.js`.
- The server half sends the stored transcript to a client that connects between turns. With `FIX=1`, the scenarios use rooms whose agent does that in `onConnect`. See `src/server.ts`.

To run with both halves:

```sh
bun apply-client-fix.ts
bunx vite dev --port 3520 --force
FIX=1 START=1 bun repro.ts
```

With `FIX=1 START=1`, every check passes. With `FIX=1` alone, `back-mid-stream` still shows and stores the doubled text. To restore the stock SDK, run `bun install --force` and restart Vite with `--force`.

## Other flags

- `DUMP=1` prints the screen and the stored transcript after each follow-up.
- `TRACE=1` logs every frame on the chat socket.
- `BASE=<url>` points at another app URL. The default is `http://localhost:3520`.
