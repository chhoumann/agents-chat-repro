import { AIChatAgent } from "@cloudflare/ai-chat";
import { routeAgentRequest } from "agents";
import { createUIMessageStream, createUIMessageStreamResponse } from "ai";
import { MessageType } from "@cloudflare/ai-chat/types";
import type { Connection } from "agents";

/** Streams "REPLY to <text> w1 ... w9 END" word by word, one word every STEP_MS (about 7 s). */
const STEP_MS = 500;
const WORDS = 12;

export class Chat extends AIChatAgent<Env> {
  private streaming = false;

  // Rooms named "...-fix-..." get the server half of the proposed fix: a
  // client connecting between turns receives the stored transcript.
  override async onConnect(connection: Connection) {
    if (this.name.includes("-fix-") && !this.streaming && this.messages.length > 0) {
      connection.send(JSON.stringify({ type: MessageType.CF_AGENT_CHAT_MESSAGES, messages: this.messages }));
    }
  }

  async onChatMessage() {
    const last = this.messages.at(-1);
    const text = last?.parts.map((p) => (p.type === "text" ? p.text : "")).join("") ?? "";
    const stream = createUIMessageStream({
      execute: async ({ writer }) => {
        this.streaming = true;
        // Rooms named "s-..." send a start chunk, which the SDK stamps with the reply's stored id.
        if (this.name.startsWith("s-")) writer.write({ type: "start" });
        writer.write({ type: "text-start", id: "t" });
        const words = [`REPLY`, `to`, text, ...Array.from({ length: WORDS - 3 }, (_, i) => `w${i + 1}`)];
        for (const word of words) {
          await new Promise((r) => setTimeout(r, STEP_MS));
          writer.write({ type: "text-delta", id: "t", delta: `${word} ` });
        }
        writer.write({ type: "text-delta", id: "t", delta: "END" });
        writer.write({ type: "text-end", id: "t" });
        this.streaming = false;
      },
    });
    return createUIMessageStreamResponse({ stream });
  }
}

export default {
  async fetch(request: Request, env: Env) {
    return (await routeAgentRequest(request, env)) ?? new Response("not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
