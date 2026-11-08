"use client";

import { useEffect } from "react";
import { adoptComposerDraft } from "@/lib/chat/composer-draft";

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
  return children;
}
