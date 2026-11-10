"use client";

import { useEffect } from "react";
import { adoptComposerDraft, reconcileRestoredComposer, type DraftIdentity } from "@/lib/chat/composer-draft";

export function ComposerDraftBoundary({
  userId,
  organizationId,
  conversationId,
  children,
}: {
  userId: string;
  organizationId: string;
  conversationId: string;
  children: React.ReactNode;
}) {
  useEffect(() => {
    adoptComposerDraft({ userId, organizationId, conversationId });
  }, [userId, organizationId, conversationId]);

  useEffect(() => {
    const identity: DraftIdentity = { userId, organizationId, conversationId };
    const timers: number[] = [];
    function syncRestoredDraft() {
      for (const timer of timers) window.clearTimeout(timer);
      timers.length = 0;
      reconcileRestoredComposer(identity);
      for (const delay of [50, 200]) {
        timers.push(
          window.setTimeout(() => {
            reconcileRestoredComposer(identity);
          }, delay),
        );
      }
    }
    function onPageShow(event: PageTransitionEvent) {
      if (!event.persisted) return;
      syncRestoredDraft();
    }
    window.addEventListener("pageshow", onPageShow);
    window.addEventListener("popstate", syncRestoredDraft);
    return () => {
      for (const timer of timers) window.clearTimeout(timer);
      window.removeEventListener("pageshow", onPageShow);
      window.removeEventListener("popstate", syncRestoredDraft);
    };
  }, [userId, organizationId, conversationId]);

  return children;
}
