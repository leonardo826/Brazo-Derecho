"use client";

import { createContext, useContext } from "react";

const CsrfContext = createContext("");

export function CsrfProvider({ token, children }: { token: string; children: React.ReactNode }) {
  return <CsrfContext.Provider value={token}>{children}</CsrfContext.Provider>;
}

export function CsrfField() {
  const token = useContext(CsrfContext);
  return <input type="hidden" name="csrf" value={token} />;
}
