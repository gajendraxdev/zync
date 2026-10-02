import { useEffect, useRef, useState } from 'react';
import { CheckCircle2 } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Select } from '../ui/Select';
import {
  DISCOVERY_OPTIONS,
  EXPERIENCE_DETAILS_MAX_LENGTH,
  IMPROVEMENT_PRIORITY_OPTIONS,
  PRIMARY_USE_OPTIONS,
  RECOMMEND_OPTIONS,
  ROLE_OPTIONS,
  WORK_CONTEXT_OPTIONS,
  resolveSurveyArch,
  resolveSurveyPlatform,
  isSurveyImprovementPriority,
  isSurveyPrimaryUse,
  splitPrefillValue,
  submitSurvey,
  type SurveyPrefill,
  type SurveyPromptKind,
} from '../../features/survey';
import { getOrCreateInstallId } from '../../features/installation/identity.js';
import type { SurveyPayload } from '../../features/survey/types';
import { feedbackInboxEnabled, submitInboxSurvey } from '../../features/feedbackInbox/client';
import { InboxReplyNotice } from '../../features/feedbackInbox/InboxReplyNotice';

export function SurveyPromptModal({
  open,
  kind,
  appVersion,
  prefill,
  onSubmitted,
  onDismissed,
  onFinished,
}: {
  open: boolean;
  kind: SurveyPromptKind;
  appVersion: string;
  prefill?: SurveyPrefill;
  onSubmitted: (prefs: SurveyPrefill) => Promise<void>;
  onDismissed: () => void;
  onFinished: () => void;
}) {
  const [role, setRole] = useState('');
  const [roleOther, setRoleOther] = useState('');
  const [workContext, setWorkContext] = useState('');
  const [workContextOther, setWorkContextOther] = useState('');
  const [discoverySource, setDiscoverySource] = useState('');
  const [discoveryOther, setDiscoveryOther] = useState('');
  const [wouldRecommend, setWouldRecommend] = useState('');
  const [primaryUse, setPrimaryUse] = useState('');
  const [improvementPriority, setImprovementPriority] = useState('');
  const [experienceDetails, setExperienceDetails] = useState('');
  const [email, setEmail] = useState('');
  const [wantUpdates, setWantUpdates] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const inFlight = useRef(false);
  const retry = useRef<{ key: string; id: string; payload: SurveyPayload } | null>(null);
  const [responseAccepted, setResponseAccepted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [thanks, setThanks] = useState(false);
  const firstFieldRef = useRef<HTMLDivElement>(null);
  const acceptedPrefsRef = useRef<SurveyPrefill | null>(null);

  useEffect(() => {
    if (!open || inFlight.current) return;

    const rolePrefill = splitPrefillValue(prefill?.lastRole, ROLE_OPTIONS);
    const workPrefill = splitPrefillValue(prefill?.lastWorkContext, WORK_CONTEXT_OPTIONS);
    const discoveryPrefill = splitPrefillValue(prefill?.lastDiscoverySource, DISCOVERY_OPTIONS, 120);
    setRole(rolePrefill.value);
    setRoleOther(rolePrefill.other);
    setWorkContext(workPrefill.value);
    setWorkContextOther(workPrefill.other);
    setDiscoverySource(discoveryPrefill.value);
    setDiscoveryOther(discoveryPrefill.other);
    setWouldRecommend('');
    setPrimaryUse(prefill?.lastPrimaryUse ?? '');
    setImprovementPriority(prefill?.lastImprovementPriority ?? '');
    setExperienceDetails('');
    setEmail('');
    setWantUpdates(false);
    retry.current = null;
    setSubmitting(false);
    setResponseAccepted(false);
    setError(null);
    setThanks(false);
    acceptedPrefsRef.current = null;

    const timer = window.setTimeout(() => {
      const trigger = firstFieldRef.current?.querySelector('button');
      trigger?.focus();
    }, 120);
    return () => window.clearTimeout(timer);
  }, [
    open,
    kind,
    appVersion,
    prefill?.lastRole,
    prefill?.lastWorkContext,
    prefill?.lastDiscoverySource,
    prefill?.lastPrimaryUse,
    prefill?.lastImprovementPriority,
  ]);

  const title = kind === 'install' ? 'Welcome to Zync' : 'Help Zync improve';
  const subtitle =
    kind === 'install'
      ? 'Quick optional intro so we can learn who uses Zync. All fields are optional. You can come back later.'
      : `Thanks for using Zync v${appVersion}. All fields are optional. You can come back later.`;

  const buildPrefs = (resolvedRole?: string, resolvedWork?: string): SurveyPrefill => ({
    lastRole: resolvedRole || role || undefined,
    lastWorkContext: resolvedWork || workContext || undefined,
    lastDiscoverySource:
      discoverySource === 'other'
        ? (discoveryOther.trim().slice(0, 120) || 'other')
        : (discoverySource || undefined),
    lastPrimaryUse: primaryUse || undefined,
    lastImprovementPriority: improvementPriority || undefined,
  });

  const handleSubmit = async () => {
    if (inFlight.current || thanks) return;
    inFlight.current = true;
    setSubmitting(true);
    setError(null);
    try {
      const resolvedRole =
        role === 'other'
          ? (roleOther.trim().slice(0, 64) || 'other')
          : (role || undefined);
      const resolvedWorkContext =
        workContext === 'other'
          ? (workContextOther.trim().slice(0, 64) || 'other')
          : (workContext || undefined);

      const prefs = acceptedPrefsRef.current ?? buildPrefs(resolvedRole, resolvedWorkContext);
      if (!acceptedPrefsRef.current) {
        const payload: SurveyPayload = {
          schemaVersion: 1,
          installId: getOrCreateInstallId(),
          surveyId: kind === 'install' ? 'install' : `release:${appVersion}`,
          appVersion,
          platform: resolveSurveyPlatform(),
          arch: resolveSurveyArch(),
          role: resolvedRole,
          workContext: resolvedWorkContext,
          discoverySource: discoverySource || undefined,
          discoveryOther:
            discoverySource === 'other' && discoveryOther.trim()
              ? discoveryOther.trim().slice(0, 120)
              : undefined,
          wouldRecommend:
            kind === 'release'
            && (wouldRecommend === 'yes' || wouldRecommend === 'somewhat' || wouldRecommend === 'no')
              ? wouldRecommend
              : undefined,
          primaryUse:
            kind === 'release' && isSurveyPrimaryUse(primaryUse)
              ? primaryUse
              : undefined,
          improvementPriority:
            kind === 'release' && isSurveyImprovementPriority(improvementPriority)
              ? improvementPriority
              : undefined,
          experienceDetails:
            kind === 'release' && experienceDetails.trim()
              ? experienceDetails.trim().slice(0, EXPERIENCE_DETAILS_MAX_LENGTH)
              : undefined,
          email: wantUpdates && email.trim() ? email.trim() : undefined,
          wantUpdates: Boolean(wantUpdates && email.trim()),
          locale: navigator.language || undefined,
          submittedAt: new Date().toISOString(),
          submittedFrom: 'app',
        };
        if (feedbackInboxEnabled) {
          const key = JSON.stringify({ ...payload, submittedAt: undefined });
          const attempt = retry.current?.key === key
            ? retry.current : { key, id: crypto.randomUUID(), payload };
          retry.current = attempt;
          await submitInboxSurvey(attempt.id, attempt.payload);
          retry.current = null;
        } else {
          await submitSurvey(payload);
        }
        acceptedPrefsRef.current = prefs;
        setResponseAccepted(true);
      }

      await onSubmitted(prefs);
      setThanks(true);
      window.setTimeout(() => {
        onFinished();
      }, 1100);
    } catch (err) {
      setError(
        acceptedPrefsRef.current
          ? 'Your response was received, but Zync could not save its completion status. Try again to finish without resending.'
          : err instanceof Error
            ? err.message
            : String(err),
      );
    } finally {
      inFlight.current = false;
      setSubmitting(false);
    }
  };

  return (
    <Modal
      isOpen={open}
      onClose={() => {
        if (thanks || inFlight.current || responseAccepted) return;
        onDismissed();
      }}
      title={thanks ? 'Thank you' : title}
      subtitle={thanks ? undefined : subtitle}
      width={kind === 'release' ? 'max-w-2xl' : 'max-w-lg'}
      showCloseButton={!thanks && !responseAccepted}
      explicitDismissOnly={thanks || responseAccepted}
    >
      {thanks ? (
        <div className="flex flex-col items-center gap-3 py-6 text-center">
          <CheckCircle2 className="text-app-success" size={36} />
          <p className="text-sm text-app-text">
            {kind === 'install' ? 'Welcome aboard.' : 'Thanks for helping Zync improve.'}
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 sm:items-start">
            <div className="space-y-1.5" ref={firstFieldRef} data-survey-first-field>
              <label className="text-xs font-medium text-app-muted">What best describes you?</label>
              <Select value={role} onChange={setRole} options={ROLE_OPTIONS} placeholder="Select…" showSearch={false} portal />
              {role === 'other' && (
                <input
                  value={roleOther}
                  onChange={(e) => setRoleOther(e.target.value)}
                  maxLength={64}
                  placeholder="Your role…"
                  className="h-9 w-full rounded-md border border-app-border bg-app-bg px-3 text-sm text-app-text outline-none focus:border-app-accent/50"
                />
              )}
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-app-muted">Company / organization</label>
              <Select
                value={workContext}
                onChange={setWorkContext}
                options={WORK_CONTEXT_OPTIONS}
                placeholder="Select…"
                showSearch={false}
                portal
              />
              {workContext === 'other' && (
                <input
                  value={workContextOther}
                  onChange={(e) => setWorkContextOther(e.target.value)}
                  maxLength={64}
                  placeholder="Tell us briefly…"
                  className="h-9 w-full rounded-md border border-app-border bg-app-bg px-3 text-sm text-app-text outline-none focus:border-app-accent/50"
                />
              )}
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-app-muted">How did you find Zync?</label>
            <Select
              value={discoverySource}
              onChange={setDiscoverySource}
              options={DISCOVERY_OPTIONS}
              placeholder="Select…"
              showSearch={false}
              portal
            />
            {discoverySource === 'other' && (
              <input
                value={discoveryOther}
                onChange={(e) => setDiscoveryOther(e.target.value)}
                maxLength={120}
                placeholder="Tell us briefly…"
                className="h-9 w-full rounded-md border border-app-border bg-app-bg px-3 text-sm text-app-text outline-none focus:border-app-accent/50"
              />
            )}
          </div>

          {kind === 'release' && (
            <div className="space-y-3 rounded-lg border border-app-border/70 bg-app-surface/35 p-3">
              <p className="text-xs font-medium text-app-text">Your experience with Zync</p>

              <div className="grid gap-3 sm:grid-cols-2 sm:items-start">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-app-muted">What do you mainly use Zync for?</label>
                  <Select
                    value={primaryUse}
                    onChange={setPrimaryUse}
                    options={PRIMARY_USE_OPTIONS}
                    placeholder="Optional…"
                    showSearch={false}
                    portal
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-app-muted">What should we improve next?</label>
                  <Select
                    value={improvementPriority}
                    onChange={setImprovementPriority}
                    options={IMPROVEMENT_PRIORITY_OPTIONS}
                    placeholder="Optional…"
                    showSearch={false}
                    portal
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between gap-3">
                  <label className="text-xs font-medium text-app-muted">What is missing or frustrating?</label>
                  <span className="text-[10px] tabular-nums text-app-muted/60">
                    {experienceDetails.length}/{EXPERIENCE_DETAILS_MAX_LENGTH}
                  </span>
                </div>
                <textarea
                  value={experienceDetails}
                  onChange={(event) => setExperienceDetails(event.target.value)}
                  maxLength={EXPERIENCE_DETAILS_MAX_LENGTH}
                  rows={3}
                  placeholder="Optional feedback…"
                  className="w-full resize-y rounded-md border border-app-border bg-app-bg px-3 py-2 text-sm text-app-text outline-none placeholder:text-app-muted/50 focus:border-app-accent/50"
                />
                <p className="text-[10px] leading-relaxed text-app-muted/70">
                  Do not include hostnames, paths, commands, credentials, terminal output, or other sensitive information.
                </p>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-app-muted">Would you recommend Zync?</label>
                <Select
                  value={wouldRecommend}
                  onChange={setWouldRecommend}
                  options={RECOMMEND_OPTIONS}
                  placeholder="Optional…"
                  showSearch={false}
                  portal
                />
              </div>
            </div>
          )}

          <div className="space-y-2">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-app-muted">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => {
                  const next = e.target.value;
                  setEmail(next);
                  if (!next.trim()) setWantUpdates(false);
                }}
                placeholder="you@example.com"
                className="h-9 w-full rounded-md border border-app-border bg-app-bg px-3 text-sm text-app-text outline-none focus:border-app-accent/50"
              />
            </div>
            <label
              className={`flex items-center gap-2 text-xs ${
                email.trim() ? 'text-app-muted' : 'text-app-muted/45'
              }`}
            >
              <input
                type="checkbox"
                checked={wantUpdates}
                disabled={!email.trim()}
                onChange={(e) => setWantUpdates(e.target.checked)}
                className="rounded border-app-border disabled:opacity-40"
              />
              Get updates from Zync
            </label>
          </div>

          {error && (
            <p className="text-xs text-app-danger">{error}</p>
          )}

          {feedbackInboxEnabled && (
            <InboxReplyNotice />
          )}

          <div className="flex items-center justify-end gap-2 pt-1">
            {!responseAccepted && (
              <Button
                variant="ghost"
                size="sm"
                disabled={submitting}
                onClick={() => { if (!inFlight.current) onDismissed(); }}
              >
                Skip for now
              </Button>
            )}
            <Button size="sm" isLoading={submitting} onClick={() => { void handleSubmit(); }}>
              {responseAccepted ? 'Finish' : 'Submit'}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
