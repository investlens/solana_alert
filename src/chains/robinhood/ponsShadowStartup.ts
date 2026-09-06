type PonsShadowStartupDependencies = {
  startSniper: () => void;
  startTracker: () => void;
  log?: (message: string) => void;
};

export function startPonsShadowServices(
  enabled: boolean,
  dependencies: PonsShadowStartupDependencies,
): boolean {
  if (!enabled) {
    (dependencies.log ?? console.log)('[PonsShadow] Disabled by PONS_SHADOW_ENABLED=false');
    return false;
  }

  dependencies.startSniper();
  dependencies.startTracker();
  return true;
}
