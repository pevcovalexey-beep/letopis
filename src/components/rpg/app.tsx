import { useEffect, useState } from "react";
import { useRpg } from "@/lib/rpg/store";
import { HeroScreen } from "./hero-screen";
import { PlayScreen } from "./play-screen";
import { useMasterProbe } from "./master-probe";
import { SettingsDialog } from "./settings-dialog";
import { WorldScreen } from "./world-screen";

export function LetopisApp() {
  const phase = useRpg((state) => state.phase);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  useMasterProbe(hydrated);

  useEffect(() => {
    let live = true;
    void Promise.resolve(useRpg.persist.rehydrate()).then(() => {
      if (live) setHydrated(true);
    });
    return () => {
      live = false;
    };
  }, []);

  return (
    <>
      {phase === "world" ? <WorldScreen onSettings={() => setSettingsOpen(true)} /> : null}
      {phase === "hero" ? <HeroScreen onSettings={() => setSettingsOpen(true)} /> : null}
      {phase === "play" ? <PlayScreen onSettings={() => setSettingsOpen(true)} /> : null}
      {settingsOpen ? <SettingsDialog onClose={() => setSettingsOpen(false)} /> : null}
    </>
  );
}
