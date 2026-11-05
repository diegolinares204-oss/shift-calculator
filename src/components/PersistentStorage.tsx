"use client";

import { useEffect, useState } from "react";
import { HardDrive, ShieldCheck, X } from "lucide-react";
import { Button, Badge, IconButton, useFeedback, cx } from "./ui";

export type PersistState = "checking" | "granted" | "not-granted" | "unsupported";

export function usePersistentStorage() {
  const [state, setState] = useState<PersistState>("checking");
  useEffect(() => {
    let alive = true;
    if (!navigator.storage?.persisted || !navigator.storage?.persist) {
      Promise.resolve().then(() => alive && setState("unsupported"));
    } else {
      navigator.storage.persisted().then((p) => alive && setState(p ? "granted" : "not-granted")).catch(() => alive && setState("unsupported"));
    }
    return () => { alive = false; };
  }, []);
  const request = async (): Promise<boolean> => {
    if (!navigator.storage?.persist) return false;
    try {
      const ok = await navigator.storage.persist();
      setState(ok ? "granted" : "not-granted");
      return ok;
    } catch {
      setState("not-granted");
      return false;
    }
  };
  return { state, request };
}

const HELP = "El navegador decide si lo concede. En Chrome y Edge suele concederse al instalar la app (Instalar / Añadir a pantalla de inicio) o al usarla con frecuencia; en Firefox te lo preguntará; en iPhone, instala la app en la pantalla de inicio. Mientras tanto, haz copias de seguridad.";

/** Tarjeta completa para Configuración. */
export function PersistentStorageCard() {
  const { state, request } = usePersistentStorage();
  const { toast } = useFeedback();
  return (
    <div className="rounded-2xl border border-line p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <HardDrive className="size-5 text-fg-3" />
          <span className="font-semibold">Almacenamiento persistente</span>
          {state === "granted" && <Badge tone="ok"><ShieldCheck className="size-3" />Activado</Badge>}
          {state === "not-granted" && <Badge tone="warn">No activado</Badge>}
          {state === "unsupported" && <Badge>No disponible en este navegador</Badge>}
        </div>
        {state === "not-granted" && (
          <Button variant="primary" size="sm" onClick={async () => {
            const ok = await request();
            toast(ok ? "Almacenamiento persistente activado: el navegador no borrará tus datos para liberar espacio" : "El navegador no lo ha concedido todavía. Instala la app y vuelve a intentarlo.", ok ? "ok" : "info");
          }}>Activar</Button>
        )}
      </div>
      <p className="mt-2 text-sm text-fg-2">
        {state === "granted"
          ? "Tus datos están protegidos: el navegador no los borrará automáticamente aunque necesite espacio. Solo se eliminan si tú borras los datos del sitio o desinstalas la app."
          : "Pide al navegador que no borre tus datos automáticamente cuando le falte espacio."}
      </p>
      {state === "not-granted" && <p className="mt-1 text-xs text-fg-3">{HELP}</p>}
    </div>
  );
}

/** Aviso compacto para Inicio mientras no esté activado. */
export function PersistentStorageBanner() {
  const { state, request } = usePersistentStorage();
  const { toast } = useFeedback();
  const [hidden, setHidden] = useState(() => {
    try { return localStorage.getItem("sc-persist-banner-hidden") === "1"; } catch { return false; }
  });
  if (state !== "not-granted" || hidden) return null;
  return (
    <div className={cx("flex flex-wrap items-center gap-3 rounded-2xl border border-warn/40 bg-warn-soft p-3 text-sm")}>
      <HardDrive className="size-5 shrink-0 text-warn" />
      <p className="min-w-0 flex-1 text-fg">Protege tus datos: activa el almacenamiento persistente para que el navegador no los borre al liberar espacio.</p>
      <Button size="sm" variant="primary" onClick={async () => {
        const ok = await request();
        toast(ok ? "Almacenamiento persistente activado" : "El navegador no lo ha concedido. Instala la app en tu dispositivo y vuelve a intentarlo.", ok ? "ok" : "info");
      }}>Activar</Button>
      <IconButton label="Ocultar aviso" className="size-8" onClick={() => { setHidden(true); try { localStorage.setItem("sc-persist-banner-hidden", "1"); } catch { /* sin almacenamiento */ } }}><X className="size-4" /></IconButton>
    </div>
  );
}
