"use client";

import { purgeComposerDrafts } from "@/lib/chat/composer-draft";

export function LogoutButton() {
  return (
    <button
      className="button ghost"
      type="submit"
      onClick={() => {
        purgeComposerDrafts();
      }}
    >
      Salir
    </button>
  );
}
