export const CONTADOR_CONVERSATION_ID = "contador";

export type DraftIdentity = {
  userId: string;
  organizationId: string;
  conversationId: string;
};

type HeldDraft = { key: string; text: string };

let held: HeldDraft | null = null;
let epoch = 0;
const listeners = new Set<() => void>();

// Solo un número de purga, nunca el texto. Sirve para que una página
// restaurada desde el historial vea que otro documento de la pestaña ya borró el borrador.
const EPOCH_KEY = "brazo-draft-epoch";

function identityKey(identity: DraftIdentity) {
  const userId = identity.userId.trim();
  const organizationId = identity.organizationId.trim();
  const conversationId = identity.conversationId.trim();
  if (!userId || !organizationId || !conversationId) return "";
  return `${userId}\n${organizationId}\n${conversationId}`;
}

function emitDraft() {
  for (const listener of listeners) listener();
}

export function subscribeComposerDraft(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function readComposerDraft(identity: DraftIdentity) {
  const key = identityKey(identity);
  if (!key || held?.key !== key) return "";
  return held.text;
}

export function writeComposerDraft(identity: DraftIdentity, text: string) {
  const key = identityKey(identity);
  if (!key) return;
  if (!text) {
    if (held?.key === key) held = null;
    else return;
  } else if (held?.key === key && held.text === text) {
    return;
  } else {
    held = { key, text };
  }
  emitDraft();
}

function publishEpoch() {
  try {
    sessionStorage.setItem(EPOCH_KEY, String(epoch));
  } catch {
    // Sin sessionStorage la memoria del documento vivo sigue siendo la fuente.
  }
}

function visibleEpoch() {
  try {
    return sessionStorage.getItem(EPOCH_KEY);
  } catch {
    return null;
  }
}

function bumpEpoch() {
  epoch += 1;
  publishEpoch();
}

export function alignComposerDraftEpoch() {
  const remote = visibleEpoch();
  const parsed = Number(remote);
  if (remote !== null && Number.isSafeInteger(parsed)) epoch = parsed;
}

alignComposerDraftEpoch();

export function adoptComposerDraft(identity: DraftIdentity) {
  const key = identityKey(identity);
  if (!key || !held || held.key === key) return;
  held = null;
  bumpEpoch();
  emitDraft();
}

export function purgeComposerDrafts() {
  const had = held !== null;
  held = null;
  bumpEpoch();
  if (had) emitDraft();
}

export function restoreComposerDraft(identity: DraftIdentity) {
  const remote = visibleEpoch();
  if (remote !== null && remote !== String(epoch)) {
    const parsed = Number(remote);
    epoch = Number.isSafeInteger(parsed) ? parsed : epoch + 1;
    if (held) {
      held = null;
      emitDraft();
    }
    return "";
  }
  return readComposerDraft(identity);
}

export function reconcileRestoredComposer(identity: DraftIdentity) {
  if (typeof document === "undefined") return;
  const allowed = restoreComposerDraft(identity);
  for (const box of document.querySelectorAll<HTMLTextAreaElement>("textarea[name='texto']")) {
    if (box.value === allowed) continue;
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
    setter?.call(box, allowed);
    box.dispatchEvent(new Event("input", { bubbles: true }));
  }
}
