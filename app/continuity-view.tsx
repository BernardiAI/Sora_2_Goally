"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { Check, Download, Film, Link2, LoaderCircle, Scissors, ShieldCheck, X } from "lucide-react";
import { buildContinuityPrompt, validateDialogue, type PromptCharacter } from "../lib/sora-prompt";
import { estimateVideoCents, providerVideoSeconds, VIDEO_SECONDS, videoRateCents, type VideoSeconds } from "../lib/video-config";

type ContinuityJob = {
  id: string;
  status: string;
  progress: number;
  estimated_cents: number;
  error_message?: string;
  provider_video_id?: string | null;
  provider_expires_at?: number | null;
  asset?: { verified: number } | null;
  request: {
    prompt: string;
    finalPrompt?: string;
    dialogue?: string;
    audioDirection?: string;
    consistencyGuardrails?: boolean;
    model: "sora-2" | "sora-2-pro";
    seconds: VideoSeconds;
    totalSeconds?: number;
    size: string;
    characters?: Array<{ name: string; description: string }>;
    videoReference?: { characterName?: string; description?: string };
    videoReferences?: Array<{ characterName?: string; description?: string }>;
    continuity?: {
      mode: "extend" | "edit";
      sourceJobId: string;
      chainRootJobId: string;
      extensionDepth: number;
      sourceTotalSeconds: number;
      appendedSeconds?: VideoSeconds;
    };
  };
};

const modelLabels = { "sora-2": "Sora 2", "sora-2-pro": "Sora 2 Pro" };
const totalDuration = (job: ContinuityJob) => Number(job.request.totalSeconds ?? job.request.seconds);
const isReadySource = (job: ContinuityJob) =>
  job.status === "ready" &&
  Boolean(job.asset?.verified) &&
  Boolean(job.provider_video_id) &&
  (!job.provider_expires_at || job.provider_expires_at * 1000 > Date.now());

function inheritedCharacters(job: ContinuityJob | null): PromptCharacter[] {
  if (!job) return [];
  const saved = (job.request.characters || []).map((item) => ({ name: item.name, description: item.description }));
  const extracted = (job.request.videoReferences?.length
    ? job.request.videoReferences
    : job.request.videoReference
      ? [job.request.videoReference]
      : []).map((item) => ({ name: item.characterName || "Reference subject", description: item.description }));
  return [...saved, ...extracted];
}

export function ContinuityView({
  jobs,
  initialSourceId,
  initialMode,
  onCreated,
}: {
  jobs: ContinuityJob[];
  initialSourceId: string | null;
  initialMode: "extend" | "edit";
  onCreated: (job: any) => void;
}) {
  const sources = useMemo(() => jobs.filter(isReadySource), [jobs]);
  const [sourceId, setSourceId] = useState(initialSourceId || "");
  const [mode, setMode] = useState<"extend" | "edit">(initialMode);
  const [prompt, setPrompt] = useState("");
  const [dialogue, setDialogue] = useState("");
  const [audioDirection, setAudioDirection] = useState("");
  const [seconds, setSeconds] = useState<VideoSeconds>("4");
  const [guardrails, setGuardrails] = useState(true);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [createdId, setCreatedId] = useState<string | null>(null);

  useEffect(() => {
    if (initialSourceId && sources.some((job) => job.id === initialSourceId)) setSourceId(initialSourceId);
    setMode(initialMode);
  }, [initialSourceId, initialMode, sources]);
  useEffect(() => {
    if (!sourceId && sources[0]) setSourceId(sources[0].id);
  }, [sourceId, sources]);

  const source = sources.find((job) => job.id === sourceId) || null;
  const created = jobs.find((job) => job.id === createdId) || null;
  const sourceSeconds = source ? totalDuration(source) : 0;
  const depth = Number(source?.request.continuity?.extensionDepth ?? 0);
  const resultSeconds = mode === "extend" ? sourceSeconds + Number(seconds) : sourceSeconds;
  const characters = inheritedCharacters(source);
  const finalPrompt = useMemo(() => buildContinuityPrompt({
    mode,
    prompt,
    dialogue,
    audioDirection,
    consistencyGuardrails: guardrails,
    characters,
  }), [mode, prompt, dialogue, audioDirection, guardrails, characters]);
  const estimate = source
    ? mode === "extend"
      ? estimateVideoCents(source.request.model, source.request.size, seconds)
      : Math.round(videoRateCents(source.request.model, source.request.size) * sourceSeconds)
    : 0;
  const extensionAllowed = depth < 6 && resultSeconds <= 120;

  function review(event: FormEvent) {
    event.preventDefault();
    setError("");
    if (!source) return setError("Choose a completed Sora clip to continue or edit.");
    if (!prompt.trim()) return setError(mode === "extend" ? "Describe what happens in the next scene." : "Describe the one change Sora should make.");
    const dialogueError = validateDialogue(dialogue);
    if (dialogueError) return setError(dialogueError);
    if (mode === "extend" && !extensionAllowed)
      return setError(depth >= 6 ? "This chain already has Sora's maximum of six extensions." : "This extension would exceed Sora's 120-second chain limit.");
    setConfirm(true);
  }

  async function submit() {
    if (!source || busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/continuity", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceJobId: source.id,
          mode,
          prompt: prompt.trim(),
          dialogue: dialogue.trim(),
          audioDirection: audioDirection.trim(),
          consistencyGuardrails: guardrails,
          ...(mode === "extend" ? { seconds } : {}),
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Continuity request failed.");
      setCreatedId(data.job.id);
      onCreated(data.job);
      setConfirm(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Continuity request failed.");
      setConfirm(false);
    } finally {
      setBusy(false);
    }
  }

  return <div className="continuity-page">
    <div className="history-heading">
      <span className="eyebrow">SORA CONTINUITY</span>
      <h2>Continuity Chain</h2>
      <p>Continue a completed Sora clip from its final moment, or make one focused edit while preserving the source structure.</p>
    </div>
    {!sources.length ? <div className="history-empty"><Link2 size={28}/><strong>No eligible source clips</strong><span>Finish and archive a Sora-generated clip first. Continuity requires its provider video ID.</span></div> :
      <div className="studio-grid continuity-grid">
        <section className="composer-card continuity-composer">
          <form onSubmit={review}>
            <label className="prompt-label">Source clip</label>
            <select className="continuity-source-select" aria-label="Source clip" value={sourceId} onChange={(event) => { setSourceId(event.target.value); setCreatedId(null); }}>
              {sources.map((job) => <option key={job.id} value={job.id}>{job.request.prompt.slice(0, 80)} · {totalDuration(job)}s</option>)}
            </select>
            {source && <div className="source-preview">
              <video controls playsInline src={`/api/generations/${source.id}/content`}/>
              <div><strong>{modelLabels[source.request.model]} · {source.request.size.replace("x", " × ")}</strong><span>{sourceSeconds}s current chain · {depth}/6 extensions used</span></div>
            </div>}

            <fieldset className="continuity-mode">
              <legend>Operation</legend>
              <label className={mode === "extend" ? "selected" : ""}><input type="radio" name="continuity-mode" value="extend" checked={mode === "extend"} onChange={() => setMode("extend")}/><Link2 size={18}/><span><strong>Continue scene</strong><small>Append a new segment from the final moment.</small></span></label>
              <label className={mode === "edit" ? "selected" : ""}><input type="radio" name="continuity-mode" value="edit" checked={mode === "edit"} onChange={() => setMode("edit")}/><Scissors size={18}/><span><strong>Targeted edit</strong><small>Change one thing; keep timing and composition.</small></span></label>
            </fieldset>

            <label className="prompt-label" htmlFor="continuity-prompt">{mode === "extend" ? "Next scene" : "Change only"}</label>
            <div className="prompt-wrap"><textarea id="continuity-prompt" value={prompt} maxLength={32000} onChange={(event) => setPrompt(event.target.value)} rows={6} placeholder={mode === "extend" ? "Without a cut, Mossy finishes turning toward Pip and quietly hands over the brass key…" : "Change only the umbrella from red to dark green."}/><span className="character-count">{prompt.length}</span></div>

            <details className="output-options dialogue-options">
              <summary><span><span className="section-number">A</span>Dialogue & audio</span><span aria-hidden>⌄</span></summary>
              <div className="dialogue-fields">
                <label>Dialogue <span>Optional · one turn per line</span><textarea aria-label="Continuity dialogue" value={dialogue} maxLength={4000} onChange={(event) => setDialogue(event.target.value)} rows={4} placeholder={'Mossy: "The key is yours."'} /></label>
                <label>Voice and sound direction <span>Optional</span><textarea aria-label="Continuity voice and sound direction" value={audioDirection} maxLength={2000} onChange={(event) => setAudioDirection(event.target.value)} rows={3} placeholder="Continue the same voice timbre, pace, room tone, and microphone perspective from the source." /></label>
                <p>The source clip supplies audio context, but Sora does not guarantee an exact voice lock. Re-state speaker names and stable vocal traits.</p>
              </div>
            </details>

            {mode === "extend" && <label className="continuity-duration">New segment length<select aria-label="Continuation length" value={seconds} onChange={(event) => setSeconds(event.target.value as VideoSeconds)}>{VIDEO_SECONDS.map((value) => <option key={value} value={value}>{value} seconds</option>)}</select></label>}

            <div className="continuity-capabilities">
              <ShieldCheck size={18}/><div><strong>What Sora inherits</strong><p>Source video, motion, camera, scene, composition, characters, and audio context. Model and resolution stay locked to the source.</p></div>
              <X size={18}/><div><strong>Not accepted on this endpoint</strong><p>Opening-frame images, Character IDs, and AI-extracted character guidance cannot be attached to a Sora extension or edit request.</p></div>
            </div>

            <label className="guardrail-toggle continuity-guardrail"><input type="checkbox" checked={guardrails} onChange={(event) => setGuardrails(event.target.checked)}/><span>Continuity and anti-hallucination guardrails</span></label>
            <div className="generation-summary"><div><span>Estimated request</span><strong>${(estimate/100).toFixed(2)}</strong></div><p>{mode === "extend" ? `${sourceSeconds}s + ${seconds}s = ${resultSeconds}s chain · provider renders ${providerVideoSeconds(seconds)}s` : `${sourceSeconds}s revised clip · source model and size inherited`}</p></div>
            {error && <div className="inline-error" role="alert">{error}</div>}
            <button className="generate-button" disabled={busy || (mode === "extend" && !extensionAllowed)}>{busy ? <LoaderCircle className="spin" size={17}/> : mode === "extend" ? <Link2 size={17}/> : <Scissors size={17}/>}Review {mode === "extend" ? "continuation" : "edit"}</button>
          </form>
        </section>

        <section className="result-column continuity-result">
          <div className="result-header"><span className="section-number">02</span><div><h2>{created ? "Continuity result" : "Source and result"}</h2><p>The full stitched clip is saved; extensions also get a separate new-scene file.</p></div></div>
          <div className={`result-stage ${created || source ? "has-result" : "empty"}`}>
            {created?.status === "ready" && created.asset?.verified ? <video className="generated-video" controls playsInline src={`/api/generations/${created.id}/content`}/> :
              created?.error_message ? <div className="empty-state"><X size={30}/><strong>Continuity request failed</strong><span>{created.error_message}</span></div> :
              created ? <div className="rendering-state"><LoaderCircle className="spin" size={30}/><strong>Creating the continuity result</strong><span>{created.progress ? `${created.progress}% complete` : "Waiting for the first update"}</span><div className="progress-track"><span style={{ width: `${Math.max(created.progress, 4)}%` }}/></div></div> :
              source ? <video className="generated-video" controls playsInline src={`/api/generations/${source.id}/content`}/> :
              <div className="empty-state"><Film size={34}/><strong>Choose a source clip</strong></div>}
          </div>
          {created?.status === "ready" && created.asset?.verified && <div className="result-actions continuity-downloads">
            <a className="download-button" href={`/api/generations/${created.id}/content`} download><Download size={15}/>Full {mode === "extend" ? "chain" : "revised clip"}</a>
            {created.request.continuity?.mode === "extend" && <a className="download-button" href={`/api/generations/${created.id}/content?variant=segment`} download><Download size={15}/>New scene only</a>}
          </div>}
          <div className="continuity-facts"><span>Extension {depth}/6 used</span><span>{sourceSeconds}/120 seconds</span><span>Source expires {source?.provider_expires_at ? new Date(source.provider_expires_at * 1000).toLocaleString() : "when OpenAI removes it"}</span></div>
        </section>
      </div>}

    {confirm && source && <div className="modal-backdrop" onClick={() => !busy && setConfirm(false)}>
      <div className="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="continuity-confirm-title" onClick={(event) => event.stopPropagation()}>
        <div className="modal-topline"><span className="modal-kicker">READY FOR SORA</span><button className="icon-button" aria-label="Close continuity confirmation" onClick={() => setConfirm(false)}><X size={17}/></button></div>
        <h2 id="continuity-confirm-title">Confirm {mode === "extend" ? "continuation" : "targeted edit"}</h2>
        <p className="modal-copy">This is the exact transformed prompt and request shape the app will send.</p>
        <div className="request-summary"><span>Final prompt sent to Sora</span><pre>{finalPrompt}</pre><dl>
          <div><dt>Operation</dt><dd>{mode === "extend" ? "Extend completed video" : "Edit completed video"}</dd></div>
          <div><dt>Source</dt><dd>{sourceSeconds}s · {modelLabels[source.request.model]}</dd></div>
          <div><dt>Result</dt><dd>{resultSeconds}s · {source.request.size.replace("x", " × ")}</dd></div>
          <div><dt>Characters / images</dt><dd>Not sent; source video only</dd></div>
          <div><dt>Estimated request</dt><dd>${(estimate/100).toFixed(2)}</dd></div>
        </dl></div>
        <div className="modal-actions"><button className="secondary-button" onClick={() => setConfirm(false)}>Back</button><button className="generate-button compact" onClick={() => void submit()} disabled={busy}>{busy ? <LoaderCircle className="spin" size={16}/> : <Check size={16}/>}Confirm & send</button></div>
      </div>
    </div>}
  </div>;
}
