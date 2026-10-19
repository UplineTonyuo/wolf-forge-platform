"use client";

import { Download } from "lucide-react";
import { createContext, useContext, useEffect, useRef, useState, useSyncExternalStore, type ReactNode, type RefObject } from "react";
import { PortalDialog } from "../account/ui/portal-dialog";
import styles from "./pwa-provider.module.css";

type InstallPrompt = Event & {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};
const InstallContext = createContext<((returnFocus: HTMLElement | null) => void) | null>(null);
const subscribeClient = () => () => {};
const isClient = () => true;
const isServer = () => false;

export function PwaProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [prompt, setPrompt] = useState<InstallPrompt | null>(null);
  const [installed, setInstalled] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [error, setError] = useState(false);
  const [confirmReload, setConfirmReload] = useState(false);
  const returnFocus = useRef<HTMLElement | null>(null);
  const cancelReloadRef = useRef<HTMLButtonElement>(null);
  const reloadTriggerRef = useRef<HTMLButtonElement>(null);
  const client = useSyncExternalStore(subscribeClient, isClient, isServer);
  const standalone = client && (window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true);
  const appleMobile = client && (/iPhone|iPad|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1));
  const mac = client && /Mac/.test(navigator.platform);
  const android = client && /Android/.test(navigator.userAgent);

  useEffect(() => {
    const available = (event: Event) => {
      event.preventDefault();
      setPrompt(event as InstallPrompt);
      setError(false);
    };
    const complete = () => { setInstalled(true); setPrompt(null); };
    window.addEventListener("beforeinstallprompt", available);
    window.addEventListener("appinstalled", complete);
    return () => {
      window.removeEventListener("beforeinstallprompt", available);
      window.removeEventListener("appinstalled", complete);
    };
  }, []);

  useEffect(() => {
    if (confirmReload) cancelReloadRef.current?.focus();
  }, [confirmReload]);

  function close() {
    setConfirmReload(false);
    setOpen(false);
    window.requestAnimationFrame(() => returnFocus.current?.focus());
  }

  async function install() {
    if (!prompt || installing) return;
    setInstalling(true);
    setError(false);
    try {
      await prompt.prompt();
      await prompt.userChoice;
    } catch {
      setError(true);
    } finally {
      setPrompt(null);
      setInstalling(false);
    }
  }

  return <InstallContext.Provider value={(target) => { returnFocus.current = target; setOpen(true); }}>
    {children}
    <PortalDialog open={open} onClose={close} title={confirmReload ? "Reload Wolf Forge?" : installed || standalone ? "Wolf Forge app" : "Install Wolf Forge"} showClose>
      <div className={styles.content}>
        {confirmReload ? <>
          <p>Save unfinished edits and wait for uploads to finish before reloading. Unsaved work will be lost if you reload now.</p>
          <div className={styles.actions}>
            <button ref={cancelReloadRef} type="button" className="button button-secondary" onClick={() => {
              setConfirmReload(false);
              window.requestAnimationFrame(() => reloadTriggerRef.current?.focus());
            }}>Cancel</button>
            <button type="button" className="button button-primary" onClick={() => window.location.reload()}>Reload now</button>
          </div>
        </> : <>
        <p>{installed || standalone ? "Wolf Forge is running as an app or has been installed from this browser." :
          "Add Wolf Forge to your device and open your workspace in its own window."}</p>
        {!installed && !standalone ? <>
          {prompt ? <button type="button" className="button button-primary" onClick={() => void install()} disabled={installing}>
            {installing ? "Opening installation…" : "Install app"}
          </button> : appleMobile ? <p>In Safari, open Share, choose Add to Home Screen, then Add. If available, keep Open as Web App enabled.</p> :
            android ? <p>In Chrome, open the browser menu, choose Add to Home screen or Install app, then confirm Install. Other Android browsers may create a browser shortcut instead.</p> :
            <p>In Chrome or Edge, use the install icon in the address bar or the browser menu’s Install app option.
              {mac ? " In Safari, choose File → Add to Dock." : " If your browser does not offer installation, open this workspace in Chrome or Edge."}</p>}
          {error ? <p role="status">Installation did not open. Use your browser’s install menu, or try again later.</p> : null}
        </> : null}
        <p>An internet connection is required for your workspace, messages and files.</p>
        <p>Updates load when you reopen or reload the app. Save unfinished work before reloading; this app will not reload automatically.</p>
        <div className={styles.actions}>
          <button ref={reloadTriggerRef} type="button" className="button button-secondary" onClick={() => setConfirmReload(true)}>Reload app</button>
          <button type="button" className="button button-secondary" onClick={close}>Done</button>
        </div>
        </>}
      </div>
    </PortalDialog>
  </InstallContext.Provider>;
}

export function PwaInstallButton({ variant, focusReturnRef }: {
  variant?: "login" | "menu" | "portal";
  focusReturnRef?: RefObject<HTMLElement | null>;
}) {
  const open = useContext(InstallContext);
  if (!open) return null;
  return <button type="button" role={variant === "menu" ? "menuitem" : undefined}
    className={variant === "login" ? styles.loginTrigger : variant === "portal" ? "portal-signout" : undefined}
    aria-label="Install or update app" title="Install or update app"
    onClick={(event) => open(focusReturnRef?.current ?? event.currentTarget)}>
    <Download aria-hidden="true" />
    <span className={variant === "portal" ? "sr-only" : undefined}>Install or update app</span>
  </button>;
}
