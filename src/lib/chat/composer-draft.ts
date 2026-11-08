export type DraftIdentity = {
  userId: string;
  organizationId: string;
  conversationId: string;
};

type HeldDraft = { key: string; text: string };

let held: HeldDraft | null = null;
const listeners = new Set<() => void>();

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

export function adoptComposerDraft(identity: DraftIdentity) {
  const key = identityKey(identity);
  if (!key || !held || held.key === key) return;
  held = null;
  emitDraft();
}

export function purgeComposerDrafts() {
  if (!held) return;
  held = null;
  emitDraft();
}
