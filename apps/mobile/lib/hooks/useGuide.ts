import { fieldsFor, type GuideAnswer, type GuideCheckValues, type GuideField, type GuidePhoto, type GuideStatus, type GuideStep, type GuideView } from '@ghostaff/shared';
import { checkGuide, getGuide, guideStep } from '@ghostaff/shared/services';
import { useCallback, useEffect, useRef, useState } from 'react';
import { guideErrorText, guideLoadProblem, type LoadProblem, movedOn } from '../guide';
import type { ReadyShot, Shot } from '../guidePhoto';
import { success } from '../haptics';
import { useEngine } from './useConnections';

// A guide's screen (docs/plans/ready/guided-access.md): the guide as the engine
// keeps it, the step it stopped at, and what the person does on each step.
//
// What the person types lives here, in the screen's state, and nowhere else.
// A field's value (the web's address, the user) may go in a step as a text
// answer; a secret (password, token, key) goes only in the check, is never
// logged, and is dropped once the check passes.

type StepInput = { answer?: GuideAnswer; photo?: GuidePhoto };

/** What the screen is waiting for: a step, a step after a photo, or the check. */
export type GuideBusy = 'step' | 'photo' | 'check' | null;

/** The check's complaint, next to the field it names. */
export type FieldError = { field?: GuideField; message: string };

/** Whether the guide still owes a step: the first one, or the closing one after a passed check. */
export function owesStep(v: Pick<GuideView, 'step' | 'status' | 'undo'>): boolean {
  if (v.status === 'open') return v.step === null;
  return (v.status === 'checked' || v.status === 'done') && !v.undo && !v.step?.done;
}

export function useGuide(id: string | null) {
  const engine = useEngine();
  const [view, setView] = useState<GuideView | null | undefined>(undefined);
  const [loadProblem, setLoadProblem] = useState<LoadProblem | null>(null);
  const [step, setStep] = useState<GuideStep | null>(null);
  const [status, setStatus] = useState<GuideStatus>('open');
  const [steps, setSteps] = useState(0);
  const [busy, setBusy] = useState<GuideBusy>(null);
  const [error, setError] = useState<string | null>(null);
  // A step that failed can be asked again as it was; a failed check is just pressed again.
  const [retryable, setRetryable] = useState(false);
  const [values, setValues] = useState<GuideCheckValues>({});
  const [fieldError, setFieldError] = useState<FieldError | null>(null);
  const [shot, setShot] = useState<Shot | null>(null);
  // The last step asked for and not answered, to try it again; with a photo, the photo to draw once it answers.
  const pending = useRef<{ input: StepInput; kind: 'step' | 'photo'; shot?: Shot } | null>(null);
  const reload = useRef<() => Promise<void>>(async () => {});

  const ask = useCallback(
    async (input: StepInput, kind: 'step' | 'photo' = 'step', sent?: Shot) => {
      if (!engine || !id) return;
      pending.current = { input, kind, shot: sent };
      setBusy(kind);
      setError(null);
      setRetryable(false);
      try {
        const res = await guideStep(engine, id, input);
        pending.current = null;
        // The mark of this step is on the photo just sent, and only once the step answered: a
        // failed send leaves the previous step and its photo as they were.
        if (sent) setShot(sent);
        setStep(res.step);
        setStatus(res.status);
        setSteps((n) => n + 1);
        setFieldError(null);
      } catch (e) {
        if (movedOn(e)) {
          pending.current = null;
          void reload.current();
        } else {
          setError(guideErrorText(e));
          setRetryable(true);
        }
      } finally {
        setBusy(null);
      }
    },
    [engine, id],
  );

  const load = useCallback(async () => {
    if (!engine || !id) return;
    try {
      const v = await getGuide(engine, id);
      setView(v);
      setStep(v.step);
      setStatus(v.status);
      setSteps(v.steps);
      setLoadProblem(null);
      if (owesStep(v)) await ask({});
    } catch (e) {
      setLoadProblem(guideLoadProblem(e));
      setView((v) => v ?? null);
    }
  }, [engine, id, ask]);
  reload.current = load;

  useEffect(() => {
    void load();
  }, [load]);

  const setValue = useCallback((field: GuideField, value: string) => {
    setValues((v) => ({ ...v, [field]: value }));
    setFieldError((f) => (f?.field === field ? null : f));
  }, []);

  const answer = useCallback((a: GuideAnswer) => ask({ answer: a }), [ask]);

  const sendPhoto = useCallback(
    (ready: ReadyShot) => ask({ photo: ready.photo }, 'photo', { uri: ready.uri, width: ready.width, height: ready.height }),
    [ask],
  );

  const retry = useCallback(() => {
    const p = pending.current;
    if (p) void ask(p.input, p.kind, p.shot);
  }, [ask]);

  /** Opens the guide again after it couldn't be read, showing it loading meanwhile. */
  const reloadGuide = useCallback(() => {
    setView(undefined);
    setLoadProblem(null);
    void load();
  }, [load]);

  const check = useCallback(async () => {
    if (!engine || !id || !view) return;
    const sent: GuideCheckValues = {};
    for (const f of fieldsFor(view.auth)) {
      const typed = values[f]?.trim();
      if (typed) sent[f] = typed;
    }
    setBusy('check');
    setError(null);
    setRetryable(false);
    setFieldError(null);
    let passed = false;
    try {
      const out = await checkGuide(engine, id, sent);
      if (!out.ok) {
        setFieldError({ field: out.field, message: out.message });
        return;
      }
      passed = true;
      // The secret is in the vault now: nothing here needs it any more.
      setValues((v) => ({ base_url: v.base_url, username: v.username }));
      setStatus(out.status);
      success();
    } catch (e) {
      if (movedOn(e)) void load();
      else setError(guideErrorText(e));
    } finally {
      setBusy(null);
    }
    // The closing step: how to take the access back.
    if (passed) await ask({});
  }, [engine, id, view, values, load, ask]);

  return { view, loadProblem, step, status, steps, busy, error, retryable, values, fieldError, shot, setValue, answer, sendPhoto, check, retry, reload: reloadGuide };
}
