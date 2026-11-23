import { useCallback, useEffect, useState } from 'react';

interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{
    outcome: 'accepted' | 'dismissed';
    platform: string;
  }>;
  prompt(): Promise<void>;
}

declare global {
  interface WindowEventMap {
    beforeinstallprompt: BeforeInstallPromptEvent;
  }
}

// Module-level store so multiple mounted PWAInstallButton instances share the captured prompt
let sharedPrompt: BeforeInstallPromptEvent | null = null;
const listeners = new Set<() => void>();

function notifyListeners() {
  listeners.forEach((fn) => fn());
}

let initializedGlobalListeners = false;

function initGlobalInstallListeners() {
  if (initializedGlobalListeners || typeof window === 'undefined') return;
  initializedGlobalListeners = true;

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    sharedPrompt = e;
    notifyListeners();
  });

  window.addEventListener('appinstalled', () => {
    sharedPrompt = null;
    notifyListeners();
  });
}

function checkIsStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    window.matchMedia('(display-mode: fullscreen)').matches ||
    Boolean((window.navigator as Navigator & { standalone?: boolean }).standalone)
  );
}

function checkIsIOS(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /iPad|iPhone|iPod/.test(navigator.userAgent);
}

export function usePWAInstall() {
  const [canPrompt, setCanPrompt] = useState<boolean>(() => Boolean(sharedPrompt));
  const [isInstalled, setIsInstalled] = useState<boolean>(checkIsStandalone);
  const [isIOS] = useState<boolean>(checkIsIOS);

  useEffect(() => {
    initGlobalInstallListeners();
    setCanPrompt(Boolean(sharedPrompt));

    const sync = () => {
      setCanPrompt(Boolean(sharedPrompt));
      setIsInstalled(checkIsStandalone());
    };

    listeners.add(sync);

    const mediaQuery = window.matchMedia('(display-mode: standalone)');
    const handleDisplayChange = () => setIsInstalled(checkIsStandalone());
    mediaQuery.addEventListener?.('change', handleDisplayChange);

    const handleInstalled = () => {
      setIsInstalled(true);
      setCanPrompt(false);
    };
    window.addEventListener('appinstalled', handleInstalled);

    return () => {
      listeners.delete(sync);
      mediaQuery.removeEventListener?.('change', handleDisplayChange);
      window.removeEventListener('appinstalled', handleInstalled);
    };
  }, []);

  const triggerInstall = useCallback(async (): Promise<'accepted' | 'dismissed' | 'manual'> => {
    if (!sharedPrompt) return 'manual';
    try {
      await sharedPrompt.prompt();
      const { outcome } = await sharedPrompt.userChoice;
      if (outcome === 'accepted') {
        sharedPrompt = null;
        notifyListeners();
      }
      return outcome;
    } catch {
      return 'manual';
    }
  }, []);

  return {
    canPrompt,
    isInstalled,
    isIOS,
    triggerInstall,
  };
}
