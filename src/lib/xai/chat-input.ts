import type { ChatFileInput, ChatMessageInput, XaiTask } from "@/lib/xai/types";

type AgentChat = Extract<XaiTask, { type: "agent_chat" }>;

const DATA_IMAGE = /^data:image\/(jpeg|png|webp|gif);base64,[a-z0-9+/=]+$/i;

export function validImageDataUrl(value: string) {
  return DATA_IMAGE.test(value) && value.length < 6_000_000;
}

function fileNotes(file: ChatFileInput) {
  if (file.imageDataUrl && validImageDataUrl(file.imageDataUrl)) return [];
  if (file.note?.trim()) return [file.note.trim()];
  if (file.name.trim()) return [`Archivo adjunto: ${file.name.trim()}.`];
  return [];
}

function preamble(task: AgentChat, businessName?: string) {
  return [businessName?.trim() ? `Cliente: ${businessName.trim()}.` : "", `Fecha de hoy: ${task.today}.`]
    .filter(Boolean)
    .join("\n");
}

export function chatTranscript(task: AgentChat, businessName?: string) {
  const lines = task.messages.map((message) => {
    const who = message.role === "user" ? "Cliente" : "Agente";
    const notes = (message.files ?? []).flatMap(fileNotes);
    return [`${who}: ${message.text.trim()}`, ...notes].filter(Boolean).join("\n");
  });
  return [preamble(task, businessName), "Conversación:", ...lines].filter(Boolean).join("\n\n");
}

export function chatHasImage(task: AgentChat) {
  return task.messages.some((message) => message.files?.some((file) => file.imageDataUrl && validImageDataUrl(file.imageDataUrl)));
}

export function chatContent(task: AgentChat, businessName?: string) {
  let headed = false;
  return task.messages.map((message: ChatMessageInput) => {
    const parts: Array<{ type: "input_text"; text: string } | { type: "input_image"; image_url: string }> = [];
    let text = message.text.trim();
    if (!headed && message.role === "user") {
      headed = true;
      text = [preamble(task, businessName), text].filter(Boolean).join("\n\n");
    }
    if (text) parts.push({ type: "input_text", text });
    for (const file of message.files ?? []) {
      if (file.imageDataUrl && validImageDataUrl(file.imageDataUrl)) {
        parts.push({ type: "input_image", image_url: file.imageDataUrl });
      } else {
        const note = fileNotes(file).join("\n");
        if (note) parts.push({ type: "input_text", text: note });
      }
    }
    if (parts.length === 0) parts.push({ type: "input_text", text: "(sin texto)" });
    return { role: message.role, content: parts };
  });
}

export function modelInput(task: AgentChat, businessName?: string) {
  return chatHasImage(task) ? chatContent(task, businessName) : chatTranscript(task, businessName);
}
