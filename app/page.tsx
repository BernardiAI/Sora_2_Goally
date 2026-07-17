"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  Check,
  ChevronDown,
  Clock3,
  Download,
  Film,
  KeyRound,
  LoaderCircle,
  Settings2,
  Sparkles,
  WandSparkles,
  X,
} from "lucide-react";

type Model = "sora-2" | "sora-2-pro";
type Orientation = "landscape" | "portrait";
type JobStatus = "generating" | "ready";

type Job = {
  id: number;
  title: string;
  prompt: string;
  status: JobStatus;
  progress: number;
  duration: string;
  cost: string;
  model: Model;
  size: string;
  remoteId: string;
  videoUrl?: string;
};

const resolutionOptions: Record<Model, Record<Orientation, { label: string; value: string }[]>> = {
  "sora-2": {
    landscape: [{ label: "720p · 1280×720", value: "1280x720" }],
    portrait: [{ label: "720p · 720×1280", value: "720x1280" }],
  },
  "sora-2-pro": {
    landscape: [
      { label: "720p · 1280×720", value: "1280x720" },
      { label: "1024p · 1792×1024", value: "1792x1024" },
      { label: "1080p · 1920×1080", value: "1920x1080" },
    ],
    portrait: [
      { label: "720p · 720×1280", value: "720x1280" },
      { label: "1024p · 1024×1792", value: "1024x1792" },
      { label: "1080p · 1080×1920", value: "1080x1920" },
    ],
  },
};

function modelLabel(model: Model) {
  return model === "sora-2-pro" ? "Sora 2 Pro" : "Sora 2";
}

function estimateCost(model: Model, size: string, seconds: string) {
  const rate = model === "sora-2" ? 0.1 : size.includes("1920") || size.includes("1080") ? 0.7 : size.includes("1792") || size.includes("1024") ? 0.5 : 0.3;
  return `$${(rate * Number(seconds)).toFixed(2)}`;
}

function formatSize(size: string) {
  return size.replace("x", " × ");
}

export default function Home() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [prompt, setPrompt] = useState("");
  const [model, setModel] = useState<Model>("sora-2");
  const [orientation, setOrientation] = useState<Orientation>("landscape");
  const [seconds, setSeconds] = useState("4");
  const [size, setSize] = useState("1280x720");
  const [showConfirm, setShowConfirm] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [generationError, setGenerationError] = useState("");
  const [connectionState, setConnectionState] = useState<"checking" | "connected" | "demo">("checking");

  const availableResolutions = resolutionOptions[model][orientation];
  const estimatedCost = estimateCost(model, size, seconds);
  const selected = useMemo(
    () => jobs.find((job) => job.id === selectedId) ?? jobs[0] ?? null,
    [jobs, selectedId],
  );

  useEffect(() => {
    fetch("/api/health")
      .then((response) => response.json())
      .then((data) => setConnectionState(data.configured ? "connected" : "demo"))
      .catch(() => setConnectionState("demo"));
  }, []);

  useEffect(() => {
    setSize(resolutionOptions[model][orientation][0].value);
  }, [model, orientation]);

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter" && prompt.trim() && !submitting) {
        event.preventDefault();
        setShowConfirm(true);
      }
    };
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, [prompt, submitting]);

  function requestConfirmation(event: FormEvent) {
    event.preventDefault();
    if (!prompt.trim() || submitting) return;
    setGenerationError("");
    setShowConfirm(true);
  }

  async function startGeneration() {
    const submittedPrompt = prompt.trim();
    if (!submittedPrompt || submitting) return;

    setSubmitting(true);
    setGenerationError("");

    try {
      const response = await fetch("/api/videos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: submittedPrompt, model, seconds, size }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Video request failed.");

      const nextId = Date.now();
      const next: Job = {
        id: nextId,
        title: submittedPrompt.split(/\s+/).slice(0, 5).join(" "),
        prompt: submittedPrompt,
        status: "generating",
        progress: 0,
        duration: `${seconds}s`,
        cost: estimatedCost,
        model,
        size,
        remoteId: data.id,
      };

      setJobs((current) => [next, ...current]);
      setSelectedId(nextId);
      setShowConfirm(false);
      setSubmitting(false);

      const poll = async () => {
        try {
          const statusResponse = await fetch(`/api/videos?id=${encodeURIComponent(data.id)}`, { cache: "no-store" });
          const statusData = await statusResponse.json();
          if (!statusResponse.ok) throw new Error(statusData.error ?? "Unable to read video status.");

          if (statusData.status === "completed" || statusData.status === "ready") {
            setJobs((current) => current.map((job) => job.id === nextId
              ? { ...job, status: "ready", progress: 100, videoUrl: `/api/videos/${data.id}/content` }
              : job));
            return;
          }

          if (statusData.status === "failed" || statusData.status === "cancelled") {
            throw new Error(statusData.error ?? `Video ${statusData.status}.`);
          }

          setJobs((current) => current.map((job) => job.id === nextId
            ? { ...job, progress: statusData.progress ?? job.progress }
            : job));
          window.setTimeout(poll, 1000);
        } catch (error) {
          setGenerationError(error instanceof Error ? error.message : "Unable to finish video generation.");
          setJobs((current) => current.filter((job) => job.id !== nextId));
          setSelectedId(null);
        }
      };

      window.setTimeout(poll, 500);
    } catch (error) {
      setGenerationError(error instanceof Error ? error.message : "Video request failed.");
      setSubmitting(false);
      setShowConfirm(false);
    }
  }

  return (
    <main className="studio-shell">
      <header className="studio-header">
        <div className="brand-lockup">
          <span className="brand-mark"><WandSparkles size={18} /></span>
          <div><span className="eyebrow">VIDEO GENERATOR</span><h1>Studio</h1></div>
        </div>
        <button className="connection-button" onClick={() => setShowSettings(true)} aria-label="Open connection settings">
          <span className={`status-dot ${connectionState === "connected" ? "green" : "amber"}`} />
          {connectionState === "checking" ? "Checking connection" : connectionState === "connected" ? "OpenAI connected" : "Setup required"}
          <Settings2 size={15} />
        </button>
      </header>

      <div className="studio-grid">
        <section className="composer-card">
          <div className="section-intro">
            <span className="section-number">01</span>
            <div><h2>Describe your clip</h2><p>Focus on the subject, motion, camera, and mood.</p></div>
          </div>

          <form onSubmit={requestConfirmation}>
            <label className="prompt-label" htmlFor="prompt">Prompt</label>
            <div className="prompt-wrap">
              <textarea
                id="prompt"
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                placeholder="A quiet desert road at dusk, slow tracking shot, warm cinematic light…"
                rows={7}
                autoFocus
              />
              <span className="character-count">{prompt.length}</span>
            </div>

            <details className="output-options">
              <summary><span><span className="section-number">02</span> Output options</span><ChevronDown size={16} /></summary>
              <div className="options-grid">
                <label>Model<select aria-label="Model" value={model} onChange={(event) => setModel(event.target.value as Model)}><option value="sora-2">Sora 2</option><option value="sora-2-pro">Sora 2 Pro</option></select></label>
                <label>Duration<select aria-label="Duration" value={seconds} onChange={(event) => setSeconds(event.target.value)}><option value="4">4 seconds</option><option value="8">8 seconds</option><option value="12">12 seconds</option></select></label>
                <label>Orientation<select aria-label="Orientation" value={orientation} onChange={(event) => setOrientation(event.target.value as Orientation)}><option value="landscape">Landscape</option><option value="portrait">Portrait</option></select></label>
                <label>Resolution<select aria-label="Resolution" value={size} onChange={(event) => setSize(event.target.value)}>{availableResolutions.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}</select></label>
              </div>
            </details>

            <div className="generation-summary">
              <div><span>Estimated total</span><strong>{estimatedCost}</strong></div>
              <p>One {seconds}-second clip · {modelLabel(model)} · {formatSize(size)}</p>
            </div>

            {generationError && <div className="inline-error" role="alert"><span className="status-dot red" />{generationError}</div>}

            <button className="generate-button" type="submit" disabled={!prompt.trim() || submitting}>
              {submitting ? <LoaderCircle size={17} className="spin" /> : <WandSparkles size={17} />}
              {submitting ? "Submitting…" : "Generate clip"}
              <span>⌘ ↵</span>
            </button>
          </form>
        </section>

        <section className="result-column" aria-live="polite">
          <div className="result-header"><span className="section-number">03</span><div><h2>Your result</h2><p>Watch and download the selected clip.</p></div></div>
          <div className={`result-stage ${selected ? "has-result" : "empty"}`}>
            {!selected ? (
              <div className="empty-state"><Film size={34} /><strong>Your canvas is clear</strong><span>Enter a prompt to create your first clip.</span></div>
            ) : selected.status === "generating" ? (
              <div className="rendering-state"><LoaderCircle size={30} className="spin" /><strong>Creating your clip</strong><span>{selected.progress ? `${selected.progress}% complete` : "Waiting for the first update"}</span><div className="progress-track"><span style={{ width: `${Math.max(selected.progress, 4)}%` }} /></div></div>
            ) : (
              <video className="generated-video" controls playsInline src={selected.videoUrl} aria-label={`Generated video: ${selected.title}`} />
            )}
          </div>

          {selected && <div className="result-meta">
            <div><strong>{selected.title}</strong><span><Clock3 size={13} /> {selected.duration} · {modelLabel(selected.model)} · {formatSize(selected.size)}</span></div>
            {selected.status === "ready" && selected.videoUrl && <a className="download-button" href={selected.videoUrl} download><Download size={15} /> Download</a>}
          </div>}

          {jobs.length > 1 && <div className="recent-clips"><h3>Recent clips</h3><div className="recent-list">{jobs.map((job) => <button key={job.id} className={job.id === selected?.id ? "selected" : ""} onClick={() => setSelectedId(job.id)}><span className="recent-icon"><Film size={15} /></span><span><strong>{job.title}</strong><small>{job.status === "ready" ? "Ready" : `${job.progress}% complete`}</small></span></button>)}</div></div>}
        </section>
      </div>

      {showConfirm && <div className="modal-backdrop" onClick={() => !submitting && setShowConfirm(false)}>
        <div className="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="confirm-title" onClick={(event) => event.stopPropagation()}>
          <div className="modal-topline"><span className="modal-kicker">READY TO GENERATE</span><button className="icon-button" aria-label="Close confirmation" onClick={() => setShowConfirm(false)} disabled={submitting}><X size={17} /></button></div>
          <h2 id="confirm-title">Confirm your clip</h2>
          <p className="modal-copy">This will create one video using the settings below.</p>
          <div className="request-summary"><span>Prompt</span><strong>{prompt.trim()}</strong><dl><div><dt>Model</dt><dd>{modelLabel(model)}</dd></div><div><dt>Duration</dt><dd>{seconds} seconds</dd></div><div><dt>Output</dt><dd>{formatSize(size)}</dd></div><div><dt>Estimated total</dt><dd>{estimatedCost}</dd></div></dl></div>
          <div className="modal-actions"><button className="secondary-button" onClick={() => setShowConfirm(false)} disabled={submitting}>Back</button><button className="generate-button compact" onClick={startGeneration} disabled={submitting}>{submitting ? <LoaderCircle size={16} className="spin" /> : <Check size={16} />}{submitting ? "Submitting…" : "Confirm & generate"}</button></div>
        </div>
      </div>}

      {showSettings && <div className="modal-backdrop" onClick={() => setShowSettings(false)}>
        <div className="settings-dialog" role="dialog" aria-modal="true" aria-labelledby="settings-title" onClick={(event) => event.stopPropagation()}>
          <div className="modal-topline"><span className="modal-kicker">CONNECTION</span><button className="icon-button" aria-label="Close settings" onClick={() => setShowSettings(false)}><X size={17} /></button></div>
          <div className="settings-icon"><KeyRound size={20} /></div><h2 id="settings-title">{connectionState === "connected" ? "OpenAI is connected" : "Connect OpenAI"}</h2>
          <p className="modal-copy">{connectionState === "connected" ? "The server can send video generation requests." : "Add OPENAI_API_KEY to .env.local, then restart the app. Keys stay on the server and are never entered in this screen."}</p>
          <div className="modal-actions"><button className="secondary-button" onClick={() => setShowSettings(false)}>Close</button></div>
        </div>
      </div>}
    </main>
  );
}
