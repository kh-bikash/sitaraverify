"use client";

import { useEffect, useRef, useState } from "react";
import type { Map as LeafletMap, Polygon as LeafletPolygon } from "leaflet";
import {
  ArrowDownToLine,
  ArrowLeftRight,
  BadgeCheck,
  BookOpen,
  Check,
  ChevronRight,
  CircleHelp,
  FileText,
  Focus,
  Layers3,
  MapPinned,
  Maximize2,
  Menu,
  ScanLine,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
  Upload,
  WandSparkles,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import "leaflet/dist/leaflet.css";

type View = "scan" | "map";
type ScanState = "ready" | "processing";
type Corner = [number, number];

const starterCorners: Corner[] = [
  [12.97455, 77.59185],
  [12.97476, 77.59412],
  [12.9729, 77.59452],
  [12.97258, 77.59218],
];

const documentLines = [
  "GOVERNMENT OF KARNATAKA",
  "RECORD OF RIGHTS, TENANCY AND CROPS",
  "Survey No. 118 / 2B     Extent: 1.42 Acres",
  "Owner: A. Narayanappa",
  "Village: Sampigehalli     Hobli: Yelahanka",
  "Mutation reference: MR 42 / 2024-25",
  "Boundaries: East — cart track; West — Survey 117",
  "North — irrigation channel; South — Survey 119",
];

function BrandMark() {
  return (
    <div className="brand-mark" aria-hidden="true">
      <span />
      <span />
      <span />
    </div>
  );
}

function ConfidenceRing() {
  return (
    <div className="confidence-ring" aria-label="OCR confidence 98.7 percent">
      <div>
        <strong>98.7</strong>
        <span>confidence</span>
      </div>
    </div>
  );
}

function OriginalPage() {
  return (
    <div className="paper paper-original" aria-label="Original scanned page preview">
      <div className="paper-stain stain-one" />
      <div className="paper-stain stain-two" />
      <p className="document-kicker">Government of Karnataka</p>
      <h3>Record of Rights, Tenancy and Crops</h3>
      <div className="original-rule" />
      {documentLines.slice(2).map((line, index) => (
        <p key={line} className={`raw-line raw-${index}`}>{line}</p>
      ))}
      <div className="faded-seal">RRT</div>
      <p className="scan-id">Digitized copy · 1998 register</p>
    </div>
  );
}

function RestoredPage({ showBlocks }: { showBlocks: boolean }) {
  return (
    <div className="paper paper-restored" aria-label="Restored searchable page preview">
      <div className="restored-head">
        <div>
          <p className="document-kicker">Government of Karnataka</p>
          <h3>Record of Rights,<br />Tenancy and Crops</h3>
        </div>
        <div className="document-code">FORM 16</div>
      </div>
      <div className="clean-rule" />
      <div className={showBlocks ? "text-block block-visible" : "text-block"}>
        <span>Property</span>
        <strong>Survey No. 118 / 2B</strong>
        <p>Extent: 1.42 Acres</p>
      </div>
      <div className={showBlocks ? "text-block block-visible" : "text-block"}>
        <span>Recorded owner</span>
        <strong>A. Narayanappa</strong>
        <p>Sampigehalli Village · Yelahanka Hobli</p>
      </div>
      <div className="boundary-grid">
        <span>East</span><p>Cart track</p><span>West</span><p>Survey 117</p>
        <span>North</span><p>Irrigation channel</p><span>South</span><p>Survey 119</p>
      </div>
      <div className="verified-line"><BadgeCheck size={14} /> Searchable text layer embedded</div>
    </div>
  );
}

function ScanWorkspace() {
  const uploadRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState("RTC_Survey_118_2B.pdf");
  const [scanState, setScanState] = useState<ScanState>("ready");
  const [progress, setProgress] = useState(100);
  const [showBlocks, setShowBlocks] = useState(false);
  const [page, setPage] = useState(1);

  const processFile = (file?: File) => {
    if (file) setFileName(file.name);
    setScanState("processing");
    setProgress(7);
    let value = 7;
    const timer = window.setInterval(() => {
      value += Math.ceil(Math.random() * 12);
      setProgress(Math.min(value, 100));
      if (value >= 100) {
        window.clearInterval(timer);
        setScanState("ready");
      }
    }, 180);
  };

  const exportPdf = async () => {
    const { jsPDF } = await import("jspdf");
    const pdf = new jsPDF({ unit: "pt", format: "a4" });
    pdf.setFillColor(247, 244, 235);
    pdf.rect(0, 0, 595, 842, "F");
    pdf.setTextColor(25, 28, 26);
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(11);
    pdf.text("GOVERNMENT OF KARNATAKA", 54, 62);
    pdf.setFontSize(25);
    pdf.text("Record of Rights,", 54, 103);
    pdf.text("Tenancy and Crops", 54, 132);
    pdf.setDrawColor(45, 99, 78);
    pdf.setLineWidth(1.5);
    pdf.line(54, 151, 541, 151);
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(11);
    documentLines.slice(2).forEach((line, index) => pdf.text(line, 54, 194 + index * 34));
    pdf.setFontSize(9);
    pdf.setTextColor(83, 92, 86);
    pdf.text("Restored with Vellum · searchable document", 54, 786);
    pdf.save(`Vellum-restored-${fileName.replace(/\.[^/.]+$/, "")}.pdf`);
  };

  return (
    <section className="workspace-section" aria-labelledby="scan-title">
      <header className="workspace-header">
        <div>
          <div className="eyebrow"><span className="live-dot" /> Private CPU workspace</div>
          <h1 id="scan-title">Restore every detail.<br /><em>Keep the document true.</em></h1>
        </div>
        <div className="header-actions">
          <button className="button button-ghost" onClick={() => uploadRef.current?.click()}><Upload size={17} /> New scan</button>
          <button className="button button-primary" onClick={exportPdf} disabled={scanState === "processing"}><ArrowDownToLine size={17} /> Export clear PDF</button>
        </div>
      </header>

      <input
        ref={uploadRef}
        type="file"
        accept="application/pdf,image/*"
        hidden
        onChange={(event) => processFile(event.target.files?.[0])}
      />

      <div className="status-strip">
        <div className="file-summary">
          <div className="file-icon"><FileText size={18} /></div>
          <div><strong>{fileName}</strong><span>8 pages · 14.8 MB</span></div>
        </div>
        <div className="pipeline-steps">
          {[
            ["Deskewed", "0.8°"],
            ["Layout", "42 blocks"],
            ["Text", "98.7%"],
            ["PDF/A", "Ready"],
          ].map(([label, value]) => (
            <div key={label}><Check size={13} /><span>{label}</span><strong>{value}</strong></div>
          ))}
        </div>
        <button className={`text-layer-toggle ${showBlocks ? "active" : ""}`} onClick={() => setShowBlocks((value) => !value)}>
          <Focus size={15} /> {showBlocks ? "Hide" : "Show"} text blocks
        </button>
      </div>

      <div className="document-stage">
        <aside className="page-rail" aria-label="Document pages">
          <div className="rail-title"><span>Pages</span><strong>08</strong></div>
          {[1, 2, 3, 4].map((item) => (
            <button key={item} className={`page-thumb ${page === item ? "active" : ""}`} onClick={() => setPage(item)}>
              <div className="mini-paper"><i /><i /><i /><i /></div>
              <span>{String(item).padStart(2, "0")}</span>
            </button>
          ))}
          <button className="more-pages">+4</button>
        </aside>

        <div className="comparison-area">
          {scanState === "processing" && (
            <div className="processing-overlay">
              <div className="processing-orbit"><ScanLine /></div>
              <strong>Rebuilding page structure</strong>
              <span>PaddleOCR · PP-StructureV3 · CPU</span>
              <div className="progress-track"><i style={{ width: `${progress}%` }} /></div>
              <b>{progress}%</b>
            </div>
          )}
          <div className="page-column">
            <div className="column-head"><span>Original scan</span><small>Source preserved</small></div>
            <OriginalPage />
          </div>
          <div className="compare-divider"><div><ArrowLeftRight size={15} /></div></div>
          <div className="page-column">
            <div className="column-head"><span>Clear document</span><small className="success-text"><Check size={12} /> Searchable</small></div>
            <RestoredPage showBlocks={showBlocks} />
          </div>
        </div>

        <aside className="inspector">
          <div className="inspector-head"><span>Document health</span><Sparkles size={16} /></div>
          <ConfidenceRing />
          <div className="metric-list">
            <div><span>Reading order</span><strong>Verified</strong></div>
            <div><span>Tables found</span><strong>02</strong></div>
            <div><span>Languages</span><strong>EN · KN</strong></div>
            <div><span>Rotation fixed</span><strong>0.8°</strong></div>
          </div>
          <div className="privacy-note"><ShieldCheck size={17} /><p><strong>Stays on your machine</strong><span>No document leaves the private OCR worker.</span></p></div>
          <button className="inspector-link">Review extracted fields <ChevronRight size={15} /></button>
        </aside>
      </div>
    </section>
  );
}

function ParcelMap({ opacity, corners, onCornerChange }: { opacity: number; corners: Corner[]; onCornerChange: (index: number, value: Corner) => void }) {
  const mapElement = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const polygonRef = useRef<LeafletPolygon | null>(null);
  const callbackRef = useRef(onCornerChange);
  callbackRef.current = onCornerChange;

  useEffect(() => {
    if (!mapElement.current || mapRef.current) return;
    let disposed = false;
    void import("leaflet").then((L) => {
      if (disposed || !mapElement.current || mapRef.current) return;
      const map = L.map(mapElement.current, { zoomControl: false, attributionControl: true }).setView([12.97365, 77.5932], 17);
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      }).addTo(map);
      L.control.zoom({ position: "bottomright" }).addTo(map);
      const polygon = L.polygon(corners, { color: "#e8ff86", weight: 3, fillColor: "#486857", fillOpacity: opacity }).addTo(map);
      polygon.bindTooltip("Survey 118/2B · 1.42 acres", { permanent: true, direction: "center", className: "parcel-label" });
      corners.forEach((corner, index) => {
        const marker = L.marker(corner, {
          draggable: true,
          icon: L.divIcon({ className: "corner-marker", html: `<span>${index + 1}</span>`, iconSize: [28, 28], iconAnchor: [14, 14] }),
        }).addTo(map);
        marker.on("drag", () => {
          const point = marker.getLatLng();
          callbackRef.current(index, [point.lat, point.lng]);
        });
      });
      map.fitBounds(polygon.getBounds(), { padding: [65, 65] });
      mapRef.current = map;
      polygonRef.current = polygon;
    });
    return () => {
      disposed = true;
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    polygonRef.current?.setLatLngs(corners);
  }, [corners]);

  useEffect(() => {
    polygonRef.current?.setStyle({ fillOpacity: opacity });
  }, [opacity]);

  return <div ref={mapElement} className="leaflet-map" aria-label="OpenStreetMap parcel boundary editor" />;
}

function MapWorkspace() {
  const [opacity, setOpacity] = useState(0.38);
  const [corners, setCorners] = useState<Corner[]>(starterCorners);
  const [located, setLocated] = useState(true);
  const [surveyNumber, setSurveyNumber] = useState("118/2B");
  const [recordOpen, setRecordOpen] = useState(true);

  const locate = () => {
    setLocated(false);
    window.setTimeout(() => setLocated(true), 650);
  };

  const updateCorner = (index: number, point: Corner) => {
    setCorners((current) => current.map((corner, cornerIndex) => cornerIndex === index ? point : corner));
  };

  return (
    <section className="workspace-section map-workspace" aria-labelledby="map-title">
      <header className="workspace-header map-header">
        <div>
          <div className="eyebrow"><span className="live-dot" /> Boundary workspace</div>
          <h1 id="map-title">Find the record.<br /><em>Trace the truth on land.</em></h1>
        </div>
        <div className="header-actions">
          <button className="button button-ghost"><Layers3 size={17} /> Import GeoJSON</button>
          <button className="button button-primary"><ArrowDownToLine size={17} /> Export boundary</button>
        </div>
      </header>

      <div className="map-layout">
        <aside className="plot-search-panel">
          <div className="search-intro"><MapPinned size={22} /><div><strong>Locate a land record</strong><span>Use the official registry reference, then confirm its corners.</span></div></div>
          <label>Survey / plot number<input value={surveyNumber} onChange={(event) => setSurveyNumber(event.target.value)} /></label>
          <div className="field-row">
            <label>Village<input defaultValue="Sampigehalli" /></label>
            <label>Hobli<input defaultValue="Yelahanka" /></label>
          </div>
          <label>District<input defaultValue="Bengaluru Urban" /></label>
          <button className="button button-primary locate-button" onClick={locate}><Search size={17} /> {located ? "Locate plot" : "Matching record…"}</button>
          <div className="source-note"><CircleHelp size={16} /><p><strong>Registry-aware, map-safe</strong><span>OpenStreetMap is the basemap. Legal parcel geometry must come from a survey record, GeoJSON, or confirmed corner points.</span></p></div>
          {recordOpen && located && (
            <div className="matched-record">
              <button className="record-close" aria-label="Close record" onClick={() => setRecordOpen(false)}><X size={14} /></button>
              <div className="match-label"><Check size={12} /> Matched sample</div>
              <h3>Survey {surveyNumber}</h3>
              <p>Sampigehalli Village · Khata 42</p>
              <div className="record-metrics"><span><b>1.42</b> acres</span><span><b>362.1</b> m perimeter</span></div>
            </div>
          )}
        </aside>

        <div className="map-canvas-wrap">
          <ParcelMap opacity={opacity} corners={corners} onCornerChange={updateCorner} />
          <div className="map-floating-top">
            <div><Focus size={15} /><span>Drag numbered corners to align</span></div>
            <button aria-label="Full screen map"><Maximize2 size={16} /></button>
          </div>
          <div className="map-legend">
            <span className="legend-swatch" />
            <div><strong>Survey {surveyNumber}</strong><small>Provisional overlay</small></div>
            <label>Transparency<input type="range" min="0.12" max="0.75" step="0.01" value={opacity} onChange={(event) => setOpacity(Number(event.target.value))} /></label>
            <b>{Math.round(opacity * 100)}%</b>
          </div>
          <div className="map-scale"><span /> 50 m</div>
        </div>

        <aside className="boundary-inspector">
          <div className="inspector-head"><span>Boundary points</span><Focus size={16} /></div>
          <p className="boundary-help">Four corners define this provisional parcel. Drag them on the map or refine coordinates below.</p>
          <div className="corner-list">
            {corners.map((corner, index) => (
              <div key={index}><span>{index + 1}</span><p><strong>{corner[0].toFixed(5)}</strong><small>{corner[1].toFixed(5)}</small></p><ChevronRight size={14} /></div>
            ))}
          </div>
          <div className="quality-card"><BadgeCheck size={17} /><div><strong>Overlay quality: High</strong><span>4 control points · ±1.8 m estimated</span></div></div>
          <button className="inspector-link">Open legal record <ChevronRight size={15} /></button>
        </aside>
      </div>
    </section>
  );
}

function UpgradeModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Upgrade plan">
      <div className="upgrade-modal">
        <button className="modal-close" onClick={onClose} aria-label="Close"><X size={18} /></button>
        <div className="modal-copy"><div className="eyebrow"><Sparkles size={13} /> Vellum Pro</div><h2>Precision work,<br /><em>without the cloud wait.</em></h2><p>Unlimited CPU restoration, searchable PDF/A export, and parcel workspaces for your whole practice.</p></div>
        <div className="plan-card">
          <div className="plan-price"><span>Pro workspace</span><strong>₹1,499<small>/month</small></strong></div>
          {["Unlimited document pages", "PP-StructureV3 local worker", "Parcel overlays and GeoJSON", "Priority batch processing"].map((item) => <div className="plan-feature" key={item}><Check size={15} />{item}</div>)}
          <button className="button button-primary">Start 14-day trial</button>
          <small>No card required · Cancel anytime</small>
        </div>
      </div>
    </div>
  );
}

export default function Home() {
  const [view, setView] = useState<View>("scan");
  const [menuOpen, setMenuOpen] = useState(false);
  const [upgradeOpen, setUpgradeOpen] = useState(false);

  return (
    <main className="app-shell">
      <aside className={`sidebar ${menuOpen ? "open" : ""}`}>
        <div className="sidebar-brand"><BrandMark /><div><strong>Vellum</strong><span>Document intelligence</span></div></div>
        <nav aria-label="Primary navigation">
          <button className={view === "scan" ? "active" : ""} onClick={() => { setView("scan"); setMenuOpen(false); }}><ScanLine size={18} /><span>Document lab</span><ChevronRight size={14} /></button>
          <button className={view === "map" ? "active" : ""} onClick={() => { setView("map"); setMenuOpen(false); }}><MapPinned size={18} /><span>Plot map</span><ChevronRight size={14} /></button>
          <button><BookOpen size={18} /><span>Records</span><b>24</b></button>
        </nav>
        <div className="sidebar-rule" />
        <nav aria-label="Secondary navigation">
          <button><WandSparkles size={18} /><span>Processing</span><b>3</b></button>
          <button><Settings size={18} /><span>Preferences</span></button>
          <button><CircleHelp size={18} /><span>Help center</span></button>
        </nav>
        <div className="pro-card">
          <Sparkles size={18} />
          <strong>Go beyond clean</strong>
          <span>Unlimited pages, batch OCR, and precise plot overlays.</span>
          <button onClick={() => setUpgradeOpen(true)}>Explore Pro <ChevronRight size={14} /></button>
        </div>
        <div className="user-card"><div>AK</div><p><strong>Arjun Kumar</strong><span>Trial · 11 days left</span></p><ChevronRight size={14} /></div>
      </aside>

      <div className="main-panel">
        <div className="mobile-topbar"><button onClick={() => setMenuOpen((value) => !value)} aria-label="Open menu"><Menu /></button><div><BrandMark /><strong>Vellum</strong></div><button onClick={() => setUpgradeOpen(true)}><Sparkles size={17} /></button></div>
        {view === "scan" ? <ScanWorkspace /> : <MapWorkspace />}
      </div>
      {menuOpen && <button className="mobile-scrim" aria-label="Close menu" onClick={() => setMenuOpen(false)} />}
      {upgradeOpen && <UpgradeModal onClose={() => setUpgradeOpen(false)} />}
    </main>
  );
}
