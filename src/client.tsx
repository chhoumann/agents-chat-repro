import { useAgentChat } from "@cloudflare/ai-chat/react";
import { useAgent } from "agents/react";
import { useState } from "react";
import { createRoot } from "react-dom/client";

const room = new URLSearchParams(location.search).get("room") ?? "default";

function App() {
  const agent = useAgent({ agent: "chat", name: room });
  const { messages, sendMessage, status } = useAgentChat({ agent });
  const [input, setInput] = useState("");
  return (
    <main>
      <p id="status">{status}</p>
      <ol id="messages">
        {messages.map((m) => (
          <li key={m.id} data-role={m.role} data-id={m.id}>
            {m.role}: {m.parts.map((p) => (p.type === "text" ? p.text : "")).join("|")}
          </li>
        ))}
      </ol>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void sendMessage({ text: input });
          setInput("");
        }}
      >
        <input id="input" value={input} onChange={(e) => setInput(e.target.value)} />
        <button id="send">Send</button>
      </form>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
