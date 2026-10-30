"use client";

import { usePathname, useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useMemo, useSyncExternalStore } from "react";
import { DEMO_TOUR_STEP_KEY, DEMO_TOUR_STEPS, DEMO_TOUR_STORAGE_KEY, demoTourPathMatches, demoTourStepIndex } from "@/lib/demo-tour";

const CHANGE_EVENT = "brazo-prueba-demo";

type TourSnapshot = {
  ready: boolean;
  open: boolean;
  step: number;
};

type TourApi = TourSnapshot & {
  target: string | null;
  next: () => void;
  back: () => void;
  dismiss: () => void;
  restart: () => void;
};

const SERVER_SNAPSHOT: TourSnapshot = { ready: false, open: false, step: 0 };
const TourContext = createContext<TourApi | null>(null);

let cacheKey = "server";
let cache: TourSnapshot = SERVER_SNAPSHOT;
let memory: { open: boolean; step: number } | null = null;

function readSnapshot(): TourSnapshot {
  if (memory) return { ready: true, open: memory.open, step: memory.step };
  try {
    const open = localStorage.getItem(DEMO_TOUR_STORAGE_KEY) !== "1";
    const step = demoTourStepIndex(sessionStorage.getItem(DEMO_TOUR_STEP_KEY));
    return { ready: true, open, step };
  } catch {
    return { ready: true, open: true, step: 0 };
  }
}

function getSnapshot() {
  const next = readSnapshot();
  const key = `${next.ready}:${next.open}:${next.step}`;
  if (key !== cacheKey) {
    cacheKey = key;
    cache = next;
  }
  return cache;
}

function subscribe(onStoreChange: () => void) {
  window.addEventListener(CHANGE_EVENT, onStoreChange);
  window.addEventListener("storage", onStoreChange);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onStoreChange);
    window.removeEventListener("storage", onStoreChange);
  };
}

function emit() {
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

function publish(open: boolean, step: number) {
  memory = { open, step };
  try {
    if (open) {
      localStorage.removeItem(DEMO_TOUR_STORAGE_KEY);
      sessionStorage.setItem(DEMO_TOUR_STEP_KEY, String(step));
    } else {
      localStorage.setItem(DEMO_TOUR_STORAGE_KEY, "1");
      sessionStorage.removeItem(DEMO_TOUR_STEP_KEY);
    }
  } catch {
    // Si el navegador bloquea el almacenamiento, el aviso igual cambia en esta visita.
  }
  emit();
}

function focusTitle() {
  requestAnimationFrame(() => {
    document.getElementById("demo-tour-title")?.focus();
    document.getElementById("prueba-la-demo")?.scrollIntoView({ block: "nearest" });
  });
}

function focusRestart() {
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      document.getElementById("reabrir-demo")?.focus();
    });
  });
}

export function DemoTourProvider({ children }: { children: React.ReactNode }) {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, () => SERVER_SNAPSHOT);
  const pathname = usePathname();
  const router = useRouter();
  const stepMeta = DEMO_TOUR_STEPS[snapshot.step] ?? DEMO_TOUR_STEPS[0];

  const api = useMemo<TourApi>(() => {
    function go(index: number) {
      const target = DEMO_TOUR_STEPS[index];
      if (!target) return;
      publish(true, index);
      if (!demoTourPathMatches(target.href, pathname)) router.push(target.href);
    }

    return {
      ready: snapshot.ready,
      open: snapshot.ready && snapshot.open,
      step: snapshot.step,
      target: snapshot.ready && snapshot.open ? stepMeta.href : null,
      next() {
        if (snapshot.step >= DEMO_TOUR_STEPS.length - 1) {
          publish(false, 0);
          focusRestart();
          return;
        }
        go(snapshot.step + 1);
        focusTitle();
      },
      back() {
        if (snapshot.step <= 0) return;
        go(snapshot.step - 1);
        focusTitle();
      },
      dismiss() {
        publish(false, 0);
        focusRestart();
      },
      restart() {
        publish(true, 0);
        if (!demoTourPathMatches(DEMO_TOUR_STEPS[0].href, pathname)) router.push(DEMO_TOUR_STEPS[0].href);
        focusTitle();
      },
    };
  }, [pathname, router, snapshot.open, snapshot.ready, snapshot.step, stepMeta.href]);

  return <TourContext.Provider value={api}>{children}</TourContext.Provider>;
}

export function useDemoTourHref() {
  return useContext(TourContext)?.target ?? null;
}

export function DemoTour() {
  const tour = useContext(TourContext);
  const step = tour ? DEMO_TOUR_STEPS[tour.step] : undefined;

  useEffect(() => {
    if (!tour?.open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      tour?.dismiss();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [tour]);

  if (!tour?.open || !step) return null;
  const last = tour.step === DEMO_TOUR_STEPS.length - 1;

  return (
    <section className="demo-tour" id="prueba-la-demo" aria-label="Prueba la demo">
      <p className="eyebrow">{step.kicker}</p>
      <h2 id="demo-tour-title" tabIndex={-1}>
        {step.title}
      </h2>
      <p>{step.body}</p>
      <div className="demo-tour-actions">
        {tour.step > 0 ? (
          <button className="button secondary" type="button" onClick={tour.back}>
            Atrás
          </button>
        ) : (
          <button className="button secondary" type="button" onClick={tour.dismiss}>
            Ahora no
          </button>
        )}
        <button className="button" type="button" onClick={tour.next}>
          {last ? "Listo" : "Siguiente"}
        </button>
        {tour.step > 0 ? (
          <button className="button secondary" type="button" onClick={tour.dismiss}>
            Cerrar
          </button>
        ) : null}
      </div>
    </section>
  );
}

export function DemoTourRestart() {
  const tour = useContext(TourContext);
  if (!tour?.ready || tour.open) return null;
  return (
    <button className="button ghost" id="reabrir-demo" type="button" onClick={tour.restart}>
      Prueba la demo
    </button>
  );
}
