/**
 * Frontend-only demo presentation state machine.
 *
 * IDLE → INTENT → AUTHORIZATION → EXECUTION → PAYMENT_RESULT →
 * OUTCOME_EVIDENCE → OUTCOME_RESULT → RESOLUTION → COMPLETE
 *
 * Pure presentation state. No backend calls, no writes, no mutations —
 * the walkthrough replays the already-loaded canonical projection.
 */

import { useCallback, useEffect, useRef, useState } from "react";

export type DemoStage =
  | "IDLE"
  | "INTENT"
  | "AUTHORIZATION"
  | "EXECUTION"
  | "PAYMENT_RESULT"
  | "OUTCOME_EVIDENCE"
  | "OUTCOME_RESULT"
  | "RESOLUTION"
  | "COMPLETE";

export const DEMO_STAGES: readonly DemoStage[] = [
  "IDLE",
  "INTENT",
  "AUTHORIZATION",
  "EXECUTION",
  "PAYMENT_RESULT",
  "OUTCOME_EVIDENCE",
  "OUTCOME_RESULT",
  "RESOLUTION",
  "COMPLETE",
];

export const RUN_STAGES: readonly DemoStage[] = DEMO_STAGES.filter(
  (s) => s !== "IDLE",
);

/** Auto-play dwell per stage (ms). Total ≈ 68s, within the 60–90s target. */
export const STAGE_DURATIONS_MS: Readonly<Record<DemoStage, number>> = {
  IDLE: 0,
  INTENT: 9000,
  AUTHORIZATION: 10000,
  EXECUTION: 10000,
  PAYMENT_RESULT: 5000,
  OUTCOME_EVIDENCE: 10000,
  OUTCOME_RESULT: 12000,
  RESOLUTION: 12000,
  COMPLETE: 0,
};

export const TOTAL_AUTOPLAY_MS = RUN_STAGES.reduce(
  (sum, s) => sum + STAGE_DURATIONS_MS[s],
  0,
);

export interface DemoController {
  readonly stage: DemoStage;
  readonly running: boolean;
  readonly paused: boolean;
  readonly stageIndex: number;
  readonly runIndex: number;
  readonly start: () => void;
  readonly next: () => void;
  readonly back: () => void;
  readonly restart: () => void;
  readonly pause: () => void;
  readonly resume: () => void;
  readonly exit: () => void;
}

export function nextStage(stage: DemoStage): DemoStage {
  const i = DEMO_STAGES.indexOf(stage);
  return DEMO_STAGES[Math.min(i + 1, DEMO_STAGES.length - 1)] ?? "IDLE";
}

export function prevStage(stage: DemoStage): DemoStage {
  const i = DEMO_STAGES.indexOf(stage);
  return DEMO_STAGES[Math.max(i - 1, 1)] ?? "INTENT";
}

/** Autoplay controller. Deterministic: advances one stage per dwell. */
export function useDemoController(
  initialStage: DemoStage = "IDLE",
): DemoController {
  const [stage, setStage] = useState<DemoStage>(initialStage);
  const [paused, setPaused] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stageRef = useRef(stage);
  stageRef.current = stage;

  const clearTimer = useCallback(() => {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  const schedule = useCallback((from: DemoStage) => {
    clearTimer();
    const dwell = STAGE_DURATIONS_MS[from];
    if (dwell <= 0 || from === "COMPLETE") return;
    timer.current = setTimeout(() => {
      const next = nextStage(stageRef.current);
      setStage(next);
      if (next !== "COMPLETE") schedule(next);
    }, dwell);
  }, [clearTimer]);

  useEffect(() => clearTimer, [clearTimer]);

  const start = useCallback(() => {
    setPaused(false);
    setStage("INTENT");
    schedule("INTENT");
  }, [schedule]);

  const next = useCallback(() => {
    setPaused(false);
    const n = nextStage(stageRef.current);
    setStage(n);
    if (n !== "COMPLETE") schedule(n);
  }, [schedule]);

  const back = useCallback(() => {
    setPaused(false);
    const p = prevStage(stageRef.current);
    setStage(p);
    schedule(p);
  }, [schedule]);

  const restart = useCallback(() => {
    clearTimer();
    setPaused(false);
    setStage("IDLE");
  }, [clearTimer]);

  const pause = useCallback(() => {
    clearTimer();
    setPaused(true);
  }, [clearTimer]);

  const resume = useCallback(() => {
    setPaused(false);
    schedule(stageRef.current);
  }, [schedule]);

  const exit = useCallback(() => {
    clearTimer();
    setPaused(false);
    setStage("IDLE");
  }, [clearTimer]);

  const running = stage !== "IDLE";

  return {
    stage,
    running,
    paused,
    stageIndex: DEMO_STAGES.indexOf(stage),
    runIndex: Math.max(0, RUN_STAGES.indexOf(stage)),
    start,
    next,
    back,
    restart,
    pause,
    resume,
    exit,
  };
}
