/**
 * Socket loss mid-stream against a plain AIChatAgent + useAgentChat app.
 * Each scenario kills the client's WebSocket mid-reply (as iOS does to a
 * backgrounded PWA), keeps reconnects failing for a while, then lets
 * PartySocket reconnect on its own, and checks the screen and the stored
 * transcript, before and after a follow-up message.
 *
 *   bun repro.ts [down-until-done|back-mid-stream]
 *   START=1  the reply carries its stored id (onChatMessage writes { type: "start" })
 *   FIX=1    rooms get the server half of the fix (transcript on idle connect)
 *   DUMP=1   print screen and stored transcript; TRACE=1 log socket frames
 *   BASE=... app URL (default http://localhost:3520)
 */
import { chromium, type Page } from "playwright";

const BASE = process.env.BASE ?? "http://localhost:3520";
const NONCE = Date.now().toString(36);
const PREFIX = `${process.env.START ? "s-" : ""}${process.env.FIX ? "x-fix-" : ""}`;
const STREAM_MS = 7000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${ok || !detail ? "" : `  -- ${detail}`}`);
  if (!ok) failures += 1;
}

const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});

async function open(room: string): Promise<Page> {
  const ctx = await browser.newContext();
  // Agent sockets are tracked so a "drop" can kill them; while dropped, new
  // connections go to a dead port, as a suspended phone's reconnects fail.
  await ctx.addInitScript(`
    window.__ws = [];
    window.__down = false;
    const Orig = window.WebSocket;
    window.WebSocket = class extends Orig {
      constructor(url, protocols) {
        const agent = String(url).includes("/agents/");
        super(agent && window.__down ? "ws://127.0.0.1:9/dead" : url, protocols);
        if (agent) {
          window.__ws.push(this);
          if (${process.env.TRACE ? "true" : "false"}) {
            this.addEventListener("open", () => console.log("WS open"));
            this.addEventListener("close", () => console.log("WS close"));
            this.addEventListener("message", (e) => console.log("WS in " + String(e.data).slice(0, 200)));
            const send = this.send.bind(this);
            this.send = (x) => { console.log("WS out " + String(x).slice(0, 200)); return send(x); };
          }
        }
      }
    };
  `);
  const page = await ctx.newPage();
  page.on("console", (m) => m.text().startsWith("WS") && console.log(`   ${m.text()}`));
  page.on("pageerror", (e) => console.log(`   page error: ${e.message}`));
  await page.goto(`${BASE}/?room=${room}`);
  await page.waitForFunction(() => (window as unknown as { __ws: WebSocket[] }).__ws.some((s) => s.readyState === 1));
  await sleep(1000);
  return page;
}

const drop = (page: Page) =>
  page.evaluate(() => {
    const w = window as unknown as { __ws: WebSocket[]; __down: boolean };
    w.__down = true;
    for (const s of w.__ws) s.close();
  });
const restore = (page: Page) => page.evaluate(() => ((window as unknown as { __down: boolean }).__down = false));
const reconnected = (page: Page, ms = 40000) =>
  page
    .waitForFunction(() => (window as unknown as { __ws: WebSocket[] }).__ws.at(-1)?.readyState === 1 && !(window as unknown as { __down: boolean }).__down, null, { timeout: ms })
    .then(() => true)
    .catch(() => false);

async function send(page: Page, text: string) {
  await page.fill("#input", text);
  await page.click("#send");
}

const assistantTexts = (page: Page) => page.$$eval('li[data-role="assistant"]', (els) => els.map((e) => e.textContent ?? ""));
async function stored(room: string): Promise<string[]> {
  const res = await fetch(`${BASE}/agents/chat/${room}/get-messages`);
  const messages = (await res.json()) as { role: string; parts: { type: string; text?: string }[] }[];
  return messages.filter((m) => m.role === "assistant").map((m) => m.parts.map((p) => (p.type === "text" ? p.text : "")).join("|"));
}
const occurrences = (haystack: string, needle: string) => haystack.split(needle).length - 1;
async function waitText(page: Page, text: string, ms: number): Promise<boolean> {
  return page
    .waitForFunction((t) => document.getElementById("messages")!.textContent!.includes(t), text, { timeout: ms })
    .then(() => true)
    .catch(() => false);
}

/** Then a follow-up send: the first reply must survive it, on screen and stored. */
async function followUp(page: Page, room: string, first: string, label: string) {
  const second = `second-${label}-${NONCE}`;
  await send(page, second);
  check(`${label}: the follow-up gets its full reply`, await waitText(page, `REPLY to ${second} w1`, 15000) && (await waitText(page, "END", 15000)));
  await sleep(STREAM_MS + 1000);
  const screen = await assistantTexts(page);
  const disk = await stored(room);
  if (process.env.DUMP) console.log(`   screen: ${JSON.stringify(screen)}\n   stored: ${JSON.stringify(disk)}`);
  check(`${label}: the first reply is stored once`, disk.filter((t) => t.includes(first)).length === 1, JSON.stringify(disk));
  const firstOnScreen = screen.find((t) => t.includes(first)) ?? "";
  const firstStored = disk.find((t) => t.includes(first)) ?? "";
  check(`${label}: after the follow-up the first reply is complete on screen`, firstOnScreen.includes("END"), JSON.stringify(firstOnScreen));
  check(`${label}: after the follow-up the first reply is stored complete`, firstStored.includes("END"), JSON.stringify(firstStored));
  check(`${label}: after the follow-up the first reply is stored without duplicated text`, occurrences(firstStored, "w1 ") <= 1, JSON.stringify(firstStored));
}

const scenarios: Record<string, () => Promise<void>> = {
  /** The socket dies mid-reply and stays dead until the reply is done (a backgrounded phone). */
  async "down-until-done"() {
    const room = `${PREFIX}a-${NONCE}`;
    const page = await open(room);
    const first = `first-a-${NONCE}`;
    await send(page, first);
    await waitText(page, `REPLY to ${first}`, 10000);
    await drop(page);
    await sleep(STREAM_MS + 1000);
    check("down-until-done: the server stored the full reply", (await stored(room)).some((t) => t.includes(first) && t.includes("END")));
    await restore(page);
    check("down-until-done: the client reconnects", await reconnected(page));
    await sleep(3000);
    const screen = (await assistantTexts(page)).find((t) => t.includes(first)) ?? "";
    check("down-until-done: after reconnect the full reply is on screen", screen.includes("END"), JSON.stringify(screen));
    await followUp(page, room, first, "down-until-done");
  },

  /** The socket dies mid-reply and comes back while the reply is still streaming. */
  async "back-mid-stream"() {
    const room = `${PREFIX}b-${NONCE}`;
    const page = await open(room);
    const first = `first-b-${NONCE}`;
    await send(page, first);
    await waitText(page, `REPLY to ${first} w1`, 10000);
    await drop(page);
    await sleep(500);
    await restore(page);
    check("back-mid-stream: the client reconnects", await reconnected(page));
    await sleep(STREAM_MS + 2000);
    const screen = (await assistantTexts(page)).find((t) => t.includes(first)) ?? "";
    check("back-mid-stream: the full reply is on screen once the stream ends", screen.includes("END"), JSON.stringify(screen));
    check("back-mid-stream: the reply's text is on screen once", occurrences(screen, "w1 ") === 1, JSON.stringify(screen));
    await followUp(page, room, first, "back-mid-stream");
  },
};

for (const [name, run] of Object.entries(scenarios)) {
  if (process.argv.length > 2 && !process.argv.slice(2).includes(name)) continue;
  console.log(`\n== ${name}`);
  await run();
}
await browser.close();
console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
