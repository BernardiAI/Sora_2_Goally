"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Archive,
  ArrowUpRight,
  BookOpen,
  Check,
  ChevronDown,
  Clapperboard,
  Clock3,
  Download,
  Film,
  FolderOpen,
  Grid2X2,
  Heart,
  ImagePlus,
  KeyRound,
  Layers3,
  LayoutGrid,
  Library,
  ListFilter,
  LoaderCircle,
  MoreHorizontal,
  Moon,
  PanelLeftClose,
  Play,
  Plus,
  Search,
  Settings2,
  Sparkles,
  SlidersHorizontal,
  Trash2,
  WandSparkles,
  X,
} from "lucide-react";

type Job = { id: number; title: string; prompt: string; status: "ready" | "generating" | "queued"; progress: number; duration: string; cost: string; tone: string; remoteId?: string; videoUrl?: string };
type Model = "sora-2" | "sora-2-pro";
type Orientation = "landscape" | "portrait";

const resolutionOptions: Record<Model, Record<Orientation, { label: string; value: string }[]>> = {
  "sora-2": { landscape: [{ label: "720p · 1280×720", value: "1280x720" }], portrait: [{ label: "720p · 720×1280", value: "720x1280" }] },
  "sora-2-pro": {
    landscape: [{ label: "720p · 1280×720", value: "1280x720" }, { label: "1024p · 1792×1024", value: "1792x1024" }, { label: "1080p · 1920×1080", value: "1920x1080" }],
    portrait: [{ label: "720p · 720×1280", value: "720x1280" }, { label: "1024p · 1024×1792", value: "1024x1792" }, { label: "1080p · 1080×1920", value: "1080x1920" }],
  },
};

function estimateCost(model: Model, size: string, seconds: string, variations: string) {
  const rate = model === "sora-2" ? 0.1 : size.includes("1920") || size.includes("1080") ? 0.7 : size.includes("1792") || size.includes("1024") ? 0.5 : 0.3;
  return `$${(rate * Number(seconds) * Number(variations)).toFixed(2)}`;
}

const seedJobs: Job[] = [];

const nav = [
  { label: "Studio", icon: Clapperboard },
  { label: "Library", icon: Library },
  { label: "Projects", icon: FolderOpen },
  { label: "Characters", icon: Sparkles },
  { label: "Batch", icon: Layers3 },
];

const workspacePages = {
  Library: {
    kicker: "WORKSPACE / LIBRARY",
    title: "Your library",
    description: "Every generated shot, reference, and reusable asset in one quiet place.",
    icon: Library,
    cards: [] as readonly (readonly [string, string, string])[],
  },
  Projects: {
    kicker: "WORKSPACE / PROJECTS",
    title: "Projects",
    description: "Keep ideas together from first prompt to final cut.",
    icon: FolderOpen,
    cards: [] as readonly (readonly [string, string, string])[],
  },
  Characters: {
    kicker: "WORKSPACE / CHARACTERS",
    title: "Characters",
    description: "Build a consistent cast you can bring into any generation.",
    icon: Sparkles,
    cards: [] as readonly (readonly [string, string, string])[],
  },
  Batch: {
    kicker: "WORKSPACE / BATCH",
    title: "Batch queue",
    description: "Line up variations and let the local renderer work through them.",
    icon: Layers3,
    cards: [] as readonly (readonly [string, string, string])[],
  },
  Favorites: {
    kicker: "WORKSPACE / FAVORITES",
    title: "Favorites",
    description: "A focused shelf for the shots you want close at hand.",
    icon: Heart,
    cards: [] as readonly (readonly [string, string, string])[],
  },
  Archive: {
    kicker: "WORKSPACE / ARCHIVE",
    title: "Archive",
    description: "Older explorations stay available without crowding your studio.",
    icon: Archive,
    cards: [] as readonly (readonly [string, string, string])[],
  },
} as const;

type WorkspacePageName = keyof typeof workspacePages;

function WorkspacePage({ page, onCreateProject, onOpenStudio }: { page: WorkspacePageName; onCreateProject: () => void; onOpenStudio: () => void }) {
  const pageData = workspacePages[page];
  const Icon = pageData.icon;
  return (
    <section className="workspace-page panel">
      <div className="workspace-page-header">
        <div>
          <div className="panel-kicker">{pageData.kicker}</div>
          <h2>{pageData.title}</h2>
          <p>{pageData.description}</p>
        </div>
        <div className="workspace-page-actions">
          <button className="secondary-button" onClick={onOpenStudio}><Clapperboard size={15} /> Open Studio</button>
          <button className="generate-button compact" onClick={onCreateProject}><Plus size={15} /> New project</button>
        </div>
      </div>
      <div className="workspace-page-grid">
        {pageData.cards.map(([title, meta, tone]) => (
          <button className="workspace-card" key={title} onClick={onOpenStudio}>
            <div className={`workspace-card-thumb ${tone}`}><div className="grain" /><Icon size={20} /></div>
            <div className="workspace-card-copy"><strong>{title}</strong><span>{meta}</span></div>
            <ArrowUpRight size={15} />
          </button>
        ))}
        <button className="workspace-card add-workspace-card" onClick={onCreateProject}><div className="add-workspace-icon"><Plus size={20} /></div><div className="workspace-card-copy"><strong>Start something new</strong><span>Open a fresh project</span></div><ArrowUpRight size={15} /></button>
      </div>
    </section>
  );
}

function NewProjectPage({ onBack }: { onBack: () => void }) {
  return (
    <section className="new-project-page panel">
      <div className="new-project-intro"><div className="panel-kicker">NEW PROJECT / SETUP</div><h2>Start a new project</h2><p>Give your next Sora film a home. You can refine these details at any time.</p></div>
      <div className="project-form-grid"><label><span>Project name</span><input autoFocus placeholder="Untitled project" /></label><label><span>Creative direction</span><select defaultValue="cinematic"><option value="cinematic">Cinematic exploration</option><option value="storyboard">Storyboard study</option><option value="social">Social cutdowns</option></select></label></div>
      <div className="project-template-row"><button className="project-template selected"><span className="template-swatch violet" /><strong>Blank canvas</strong><small>Start from your own prompt</small></button><button className="project-template"><span className="template-swatch ocean" /><strong>Visual study</strong><small>Prompt, references, and variations</small></button><button className="project-template"><span className="template-swatch paper" /><strong>Character world</strong><small>Keep a cast consistent</small></button></div>
      <div className="new-project-actions"><button className="secondary-button" onClick={onBack}>Back to Studio</button><button className="generate-button" onClick={onBack}><Plus size={16} /> Create project</button></div>
    </section>
  );
}

function VideoTile({ job, selected, onSelect }: { job: Job; selected: boolean; onSelect: () => void }) {
  return (
    <button className={`video-tile ${selected ? "selected" : ""}`} onClick={onSelect}>
      <div className={`thumb ${job.tone}`}><div className="grain" />{job.status === "ready" && <span className="play-badge"><Play size={12} fill="currentColor" /></span>}{job.status !== "ready" && <span className="tile-progress">{job.status === "queued" ? "Queued" : `${job.progress}%`}</span>}</div>
      <div className="tile-copy"><div className="tile-title">{job.title}</div><div className="tile-meta"><span>{job.duration}</span><span>·</span><span>{job.cost}</span></div></div>
    </button>
  );
}

function StatusPill({ status }: { status: Job["status"] }) {
  const label = status === "ready" ? "Ready" : status === "generating" ? "Generating" : "Queued";
  return <span className={`status-pill ${status}`}><span className="status-dot" />{label}</span>;
}

export default function Home() {
  const [activeNav, setActiveNav] = useState("Studio");
  const [jobs, setJobs] = useState(seedJobs);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [prompt, setPrompt] = useState("");
  const [showConfirm, setShowConfirm] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [keyDraft, setKeyDraft] = useState("");
  const [keyMessage, setKeyMessage] = useState("");
  const [saved, setSaved] = useState(false);
  const [connectionState, setConnectionState] = useState<"checking" | "connected" | "demo">("checking");
  const [generationError, setGenerationError] = useState("");
  const [inspectorTab, setInspectorTab] = useState<"create" | "edit" | "extend">("create");
  const [variation, setVariation] = useState("1");
  const [model, setModel] = useState<Model>("sora-2");
  const [orientation, setOrientation] = useState<Orientation>("landscape");
  const [seconds, setSeconds] = useState("4");
  const [size, setSize] = useState("1280x720");

  const activeResolutionOptions = resolutionOptions[model][orientation];
  const estimatedCost = estimateCost(model, size, seconds, variation);

  const selected = useMemo(() => jobs.find((j) => j.id === selectedId) ?? jobs[0] ?? null, [jobs, selectedId]);

  function navigateTo(destination: string) {
    setActiveNav(destination);
    const slug = destination === "Studio" ? "" : destination.toLowerCase().replace(/\s+/g, "-");
    window.history.pushState({}, "", slug ? `/#${slug}` : "/");
  }

  useEffect(() => {
    const syncRoute = () => {
      const slug = window.location.hash.replace(/^#/, "");
      const destination = slug ? slug.split("-").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ") : "Studio";
      setActiveNav(destination === "New Project" ? "New project" : destination);
    };
    syncRoute();
    window.addEventListener("popstate", syncRoute);
    window.addEventListener("hashchange", syncRoute);
    return () => { window.removeEventListener("popstate", syncRoute); window.removeEventListener("hashchange", syncRoute); };
  }, []);

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "n") {
        event.preventDefault();
        navigateTo("New project");
      }
    };
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  });

  useEffect(() => {
    fetch("/api/health").then((response) => response.json()).then((data) => setConnectionState(data.configured ? "connected" : "demo")).catch(() => setConnectionState("demo"));
  }, []);

  useEffect(() => {
    setSize(resolutionOptions[model][orientation][0].value);
  }, [model, orientation]);

  useEffect(() => {
    const inspector = document.querySelector<HTMLElement>(".inspector");
    const outputSection = inspector?.querySelectorAll<HTMLElement>(".form-section")[2];
    if (!inspector || !outputSection) return;
    const selectButtons = Array.from(outputSection.querySelectorAll<HTMLButtonElement>(".select-row .select-control"));

    const cycleLength = () => setSeconds((current) => current === "4" ? "8" : current === "8" ? "12" : "4");
    const cycleResolution = () => setSize((current) => {
      const index = activeResolutionOptions.findIndex((option) => option.value === current);
      return activeResolutionOptions[(index + 1) % activeResolutionOptions.length].value;
    });
    const syncOutputLabels = () => {
      const buttons = outputSection.querySelectorAll<HTMLButtonElement>(".select-row .select-control");
      const values = [model === "sora-2-pro" ? "Sora 2 Pro" : "Sora 2", `${seconds} seconds`, activeResolutionOptions.find((option) => option.value === size)?.label ?? "720p · 1280×720"];
      values.forEach((value, index) => {
        const label = buttons[index]?.querySelector<HTMLElement>(".control-label");
        if (!label?.parentElement) return;
        label.parentElement.replaceChildren(label, document.createTextNode(value));
      });
    };
    const handleClick = (event: Event) => {
      const target = event.target as HTMLElement;
      const button = target.closest<HTMLButtonElement>("button");
      if (!button || !inspector.contains(button)) return;
      const section = button.closest<HTMLElement>(".form-section");
      if (section === outputSection) {
        if (button.matches(".segmented button")) setOrientation(button.textContent?.trim().toLowerCase() === "portrait" ? "portrait" : "landscape");
        else if (button === selectButtons[0]) setModel((current) => current === "sora-2" ? "sora-2-pro" : "sora-2");
        else if (button === selectButtons[1]) cycleLength();
        else if (button === selectButtons[2]) cycleResolution();
        else if (button.classList.contains("text-button")) { setModel("sora-2"); setOrientation("landscape"); setSeconds("4"); setSize("1280x720"); }
      } else if (button.classList.contains("text-button")) {
        setPrompt((current) => current ? `${current} Smooth cinematic camera movement, soft volumetric lighting.` : "A cinematic scene with smooth camera movement, soft volumetric lighting, and a refined editorial mood.");
      } else if (button.closest(".prompt-chips")) {
        const chip = button.textContent?.replace("+", "").trim();
        if (chip) setPrompt((current) => `${current}${current ? " " : ""}${chip.toLowerCase()} with intentional detail.`);
      } else if (button.classList.contains("upload-card")) {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = "image/jpeg,image/png,image/webp";
        input.onchange = () => { const file = input.files?.[0]; if (file) button.querySelector("span")!.textContent = `Reference: ${file.name}`; };
        input.click();
      }
    };
    inspector.addEventListener("click", handleClick);
    syncOutputLabels();
    return () => inspector.removeEventListener("click", handleClick);
  }, [activeResolutionOptions, model, orientation, seconds, size]);

  async function startGeneration() {
    const nextId = jobs.length ? Math.max(...jobs.map((j) => j.id)) + 1 : 1;
    const next: Job = { id: nextId, title: prompt.trim() ? prompt.trim().split(" ").slice(0, 3).join(" ") : "Untitled shot", prompt: prompt || "A cinematic scene with soft movement and a quiet atmosphere", status: "queued", progress: 0, duration: `${seconds.padStart(2, "0")}s`, cost: estimatedCost, tone: "violet" };
    setGenerationError("");
    setJobs((current) => [next, ...current]);
    setSelectedId(nextId);
    setPrompt("");
    setShowConfirm(false);
    try {
      const response = await fetch("/api/videos", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt: next.prompt, model, seconds, size }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Video request failed.");
      setJobs((current) => current.map((j) => j.id === nextId ? { ...j, status: "generating", progress: 5, remoteId: data.id } : j));
      const poll = async () => {
        try {
          const statusResponse = await fetch(`/api/videos?id=${encodeURIComponent(data.id)}`, { cache: "no-store" });
          const statusData = await statusResponse.json();
          if (!statusResponse.ok) throw new Error(statusData.error ?? "Unable to read video status.");
          if (statusData.status === "completed" || statusData.status === "ready") {
            setJobs((current) => current.map((j) => j.id === nextId ? { ...j, status: "ready", progress: 100, videoUrl: `/api/videos/${data.id}/content` } : j));
            return;
          }
          if (statusData.status === "failed" || statusData.status === "cancelled") throw new Error(statusData.error ?? `Video ${statusData.status}.`);
          setJobs((current) => current.map((j) => j.id === nextId ? { ...j, status: "generating", progress: statusData.progress ?? j.progress } : j));
          window.setTimeout(poll, 4000);
        } catch (error) {
          setGenerationError(error instanceof Error ? error.message : "Unable to finish video generation.");
          setJobs((current) => current.filter((j) => j.id !== nextId));
        }
      };
      window.setTimeout(poll, 2500);
    } catch (error) {
      setGenerationError(error instanceof Error ? error.message : "Video request failed.");
      setJobs((current) => current.filter((j) => j.id !== nextId));
    }
  }

  function saveKey() {
    if (!keyDraft.trim()) return setKeyMessage("Paste a key to test the connection.");
    setKeyMessage("The app reads the server-side .env.local key after restart.");
    setSaved(true);
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand"><div className="brand-mark"><WandSparkles size={16} /></div><span>Sora Studio</span><span className="version">v5</span></div>
        <button className="new-project" onClick={() => navigateTo("New project")}><Plus size={16} /> New project <span className="shortcut">⌘ N</span></button>
        <nav className="primary-nav">
          <div className="nav-label">Workspace</div>
          {nav.map(({ label, icon: Icon }) => <button key={label} className={`nav-item ${activeNav === label ? "active" : ""}`} onClick={() => navigateTo(label)}><Icon size={16} /><span>{label}</span></button>)}
        </nav>
        <div className="sidebar-divider" />
        <button className={`nav-item subtle ${activeNav === "Favorites" ? "active" : ""}`} onClick={() => navigateTo("Favorites")}><Heart size={16} /><span>Favorites</span></button>
        <button className={`nav-item subtle ${activeNav === "Archive" ? "active" : ""}`} onClick={() => navigateTo("Archive")}><Archive size={16} /><span>Archive</span></button>
        <div className="sidebar-bottom">
          <div className="storage-card"><div className="storage-header"><span>Local library</span><span>Empty</span></div><div className="storage-bar"><span style={{ width: 0 }} /></div><div className="storage-foot"><span>0 videos</span><button>Manage</button></div></div>
          <button className="nav-item subtle settings-link" onClick={() => setShowSettings(true)}><Settings2 size={16} /><span>Settings</span><span className={`key-state ${connectionState === "connected" ? "connected" : ""}`}><span className={`status-dot ${connectionState === "connected" ? "green" : "amber"}`} />{connectionState === "connected" ? "Connected" : "Demo mode"}</span></button>
          <div className="profile"><div className="avatar">EB</div><div><strong>Evan&apos;s workspace</strong><span>Local only</span></div><MoreHorizontal size={16} /></div>
        </div>
      </aside>

      <section className="content">
        <header className="topbar"><div><div className="eyebrow">{activeNav === "Studio" ? "PROJECT / INBOX" : activeNav === "New project" ? "PROJECT / NEW" : `WORKSPACE / ${activeNav.toUpperCase()}`}</div><h1>{activeNav === "Studio" ? "Studio" : activeNav}</h1></div><div className="top-actions"><button className="icon-button"><Search size={17} /></button><button className="icon-button"><BookOpen size={17} /></button><button className="demo-pill" onClick={() => setShowSettings(true)}><span className={`status-dot ${connectionState === "connected" ? "green" : "amber"}`} />{connectionState === "connected" ? "OpenAI connected" : "Demo mode"}</button></div></header>

        {activeNav === "Studio" ? <div className="workspace-grid">
          <section className="shots-panel panel">
            <div className="panel-header"><div><div className="panel-kicker">INBOX / {jobs.length.toString().padStart(2, "0")} SHOTS</div><h2>{jobs.length ? "Today’s explorations" : "No shots yet"}</h2></div><button className="icon-button small"><PanelLeftClose size={15} /></button></div>
            <div className="shot-list">{jobs.map((job) => <VideoTile key={job.id} job={job} selected={job.id === selectedId} onSelect={() => setSelectedId(job.id)} />)}</div>
            <button className="add-shot" onClick={() => document.getElementById("prompt")?.focus()}><Plus size={15} /> Add shot</button>
          </section>

          <section className="stage-panel">
            <div className={`hero-video ${selected?.tone ?? "empty"}`}><div className="hero-glow" /><div className="grain" />{selected ? <>{selected.status === "ready" ? selected.videoUrl ? <video className="generated-video" controls playsInline src={selected.videoUrl} /> : <button className="hero-play"><Play size={22} fill="currentColor" /></button> : <div className="generating-state"><LoaderCircle size={24} className="spin" /><span>{selected.status === "queued" ? "Waiting in queue" : `Rendering · ${selected.progress}%`}</span><div className="large-progress"><span style={{ width: `${selected.progress}%` }} /></div></div>}<div className="hero-caption"><span>{selected.title}</span><span className="hero-caption-meta"><Clock3 size={13} /> {selected.duration} <span>·</span> {selected.status === "ready" ? "720p" : "Sora 2"}</span></div></> : <div className="empty-stage"><Film size={28} /><strong>Your canvas is clear</strong><span>Describe a shot to create your first video.</span><button onClick={() => document.getElementById("prompt")?.focus()}>Start with a prompt</button></div>}</div>
            <div className="stage-toolbar"><div className="toolbar-left"><button className="toolbar-button"><Play size={14} /> Preview</button><button className="toolbar-button"><Grid2X2 size={14} /> Compare</button><button className="toolbar-button"><Download size={14} /> Export</button></div><div className="toolbar-right"><button className="icon-button small"><Heart size={15} /></button><button className="icon-button small"><MoreHorizontal size={15} /></button></div></div>
            <div className="timeline"><div className="timeline-ruler"><span>00:00</span><span>00:02</span><span>00:04</span><span>00:06</span><span>00:08</span></div><div className="timeline-track"><span className="timeline-fill" /><span className="scrubber" /></div></div>
            {selected && <div className="lineage"><div className="lineage-title"><span>Generation lineage</span><button>View graph <ArrowUpRight size={13} /></button></div><div className="lineage-row"><div className="lineage-node active"><span className={`mini-thumb ${selected.tone}`} /><div><strong>{selected.title}</strong><span>Original</span></div></div><div className="lineage-connector" /><button className="lineage-add"><Plus size={14} /></button></div></div>}
          </section>

          <aside className="inspector panel"><div className="inspector-tabs"><button className={inspectorTab === "create" ? "active" : ""} onClick={() => setInspectorTab("create")}>Create</button><button className={inspectorTab === "edit" ? "active" : ""} onClick={() => setInspectorTab("edit")}>Edit</button><button className={inspectorTab === "extend" ? "active" : ""} onClick={() => setInspectorTab("extend")}>Extend</button></div><div className="inspector-content"><div className="form-section"><div className="section-heading"><span>Prompt</span><button className="text-button">Enhance <Sparkles size={13} /></button></div><textarea id="prompt" value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="Describe the motion, camera, and feeling you want to see…" /><div className="prompt-chips"><button>+ Subject</button><button>+ Camera</button><button>+ Lighting</button><button>+ Style</button></div></div><div className="form-section"><div className="section-heading"><span>Opening frame</span><span className="optional">Optional</span></div><button className="upload-card"><ImagePlus size={18} /><span>Add an image reference</span><small>JPEG, PNG, or WebP · exact fit preview</small></button></div><div className="form-section"><div className="section-heading"><span>Output</span><button className="text-button">Reset</button></div><div className="segmented"><button className="selected">Landscape</button><button>Portrait</button></div><div className="select-row"><button className="select-control"><span><span className="control-label">Model</span>Sora 2</span><ChevronDown size={14} /></button><button className="select-control"><span><span className="control-label">Length</span>4 seconds</span><ChevronDown size={14} /></button></div><div className="select-row"><button className="select-control"><span><span className="control-label">Resolution</span>720p · 1280×720</span><ChevronDown size={14} /></button><button className="select-control"><span><span className="control-label">Variations</span><select value={variation} onChange={(e) => setVariation(e.target.value)} onClick={(e) => e.stopPropagation()}><option value="1">1</option><option value="2">2</option><option value="4">4</option></select></span><ChevronDown size={14} /></button></div></div><div className="quote-card"><div><span className="quote-label">Estimated total</span><strong>{variation === "4" ? "$1.60" : "$0.40"}</strong></div><span className="quote-detail">{variation} variation · 4 sec · Sora 2<br />Quote expires in 04:52</span></div><button className="generate-button" onClick={() => setShowConfirm(true)} disabled={inspectorTab !== "create"}><WandSparkles size={16} /> Generate <span>⌘ ↵</span></button><div className="demo-note"><span className="status-dot amber" /> Demo provider active · no API key connected</div></div></aside>
        </div> : activeNav === "New project" ? <NewProjectPage onBack={() => navigateTo("Studio")} /> : <WorkspacePage page={activeNav as WorkspacePageName} onCreateProject={() => navigateTo("New project")} onOpenStudio={() => navigateTo("Studio")} />}
      </section>

      <section className="jobs-dock"><div className="dock-label"><span className="live-dot" /> Jobs <strong>{jobs.filter((j) => j.status !== "ready").length}</strong></div><div className="dock-jobs">{jobs.filter((j) => j.status !== "ready").slice(0, 2).map((job) => <button className="dock-job" key={job.id} onClick={() => setSelectedId(job.id)}><span className={`dock-thumb ${job.tone}`} /><span className="dock-job-copy"><strong>{job.title}</strong><span>{job.status === "queued" ? "Queued" : `Rendering · ${job.progress}%`}</span></span><span className="dock-progress"><span style={{ width: `${job.progress}%` }} /></span></button>)}</div>{jobs.length > 0 && <button className="dock-expand">View all <ArrowUpRight size={13} /></button>}</section>

      {showConfirm && <div className="modal-backdrop" onClick={() => setShowConfirm(false)}><div className="confirm-sheet" onClick={(e) => e.stopPropagation()}><div className="modal-topline"><span className="modal-kicker">READY TO GENERATE</span><button className="icon-button small" onClick={() => setShowConfirm(false)}><X size={15} /></button></div><h2>Confirm this generation</h2><p className="modal-copy">Your request will be added to the local Jobs Dock. In demo mode, the provider will simulate the full lifecycle without contacting OpenAI.</p><div className="request-summary"><div><span>Prompt</span><strong>{prompt || "A cinematic scene with soft movement and a quiet atmosphere"}</strong></div><div className="summary-grid"><div><span>Model</span><strong>Sora 2</strong></div><div><span>Output</span><strong>1280 × 720</strong></div><div><span>Length</span><strong>4 seconds</strong></div><div><span>Variations</span><strong>{variation}</strong></div></div></div><div className="confirm-total"><span>Maximum estimated total</span><strong>{variation === "4" ? "$1.60" : "$0.40"}</strong></div><div className="modal-actions"><button className="secondary-button" onClick={() => setShowConfirm(false)}>Back</button><button className="generate-button" onClick={startGeneration}><Check size={16} /> Confirm & generate</button></div></div></div>}

      {showSettings && <div className="modal-backdrop" onClick={() => setShowSettings(false)}><div className="settings-sheet" onClick={(e) => e.stopPropagation()}><div className="modal-topline"><div><span className="modal-kicker">SETTINGS / CONNECTION</span><h2>Bring your own key</h2></div><button className="icon-button small" onClick={() => setShowSettings(false)}><X size={15} /></button></div><div className="settings-banner"><div className="banner-icon"><KeyRound size={17} /></div><div><strong>Demo mode is active</strong><span>Connect a key to enable real Sora requests. It stays server-side and is never shown back in full.</span></div></div><label className="key-label" htmlFor="api-key">OpenAI API key</label><div className="key-input-wrap"><KeyRound size={16} /><input id="api-key" type="password" value={keyDraft} onChange={(e) => { setKeyDraft(e.target.value); setKeyMessage(""); }} placeholder="sk-proj-…" autoComplete="new-password" /><button className="text-button">Get a key <ArrowUpRight size={13} /></button></div>{keyMessage && <div className="key-message"><span className="status-dot amber" />{keyMessage}</div>}<div className="settings-list"><div><span>Storage</span><strong>Project .env.local</strong></div><div><span>Library</span><strong>~/Movies/Sora Studio</strong></div><div><span>Theme</span><strong><Moon size={14} /> Dark</strong></div></div><div className="modal-actions"><button className="secondary-button" onClick={() => setShowSettings(false)}>Close</button><button className="generate-button" onClick={saveKey} disabled={!keyDraft.trim()}>{saved ? <Check size={16} /> : <SlidersHorizontal size={16} />} Test & save</button></div></div></div>}
      {generationError && <div className="generation-error"><span className="status-dot red" />{generationError}</div>}
    </main>
  );
}
