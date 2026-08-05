"use client";

import { useEffect, useRef, useState } from "react";
import type { Map as LeafletMap, Polygon as LeafletPolygon } from "leaflet";
import {
  AlertTriangle,
  ArrowDownToLine,
  ArrowLeftRight,
  BadgeCheck,
  BookOpen,
  Check,
  ChevronRight,
  CircleHelp,
  CircleCheck,
  CircleX,
  Database,
  FileJson,
  FileText,
  Focus,
  Layers3,
  Languages,
  LayoutDashboard,
  Link2,
  MapPinned,
  Maximize2,
  Menu,
  ScanLine,
  Search,
  Settings,
  ShieldCheck,
  ShieldAlert,
  Sparkles,
  RefreshCw,
  Trash2,
  Upload,
  WandSparkles,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import "leaflet/dist/leaflet.css";

type View = "verification" | "scan" | "map";
type ScanState = "ready" | "processing";
type Corner = [number, number];
type UploadedDocument = { url: string; clearUrl: string; kind: "pdf" | "image"; name: string; size: string };
type VerificationStatus = "positive" | "refer" | "negative";

type StoredDocument = {
  blob: Blob;
  name: string;
  type: string;
  lastModified: number;
};

const DOCUMENT_DB = "sitaara-private-documents";
const DOCUMENT_STORE = "active-document";

function openDocumentDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DOCUMENT_DB, 1);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(DOCUMENT_STORE)) database.createObjectStore(DOCUMENT_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function saveDocumentLocally(file: File) {
  const database = await openDocumentDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(DOCUMENT_STORE, "readwrite");
    transaction.objectStore(DOCUMENT_STORE).put({ blob: file, name: file.name, type: file.type, lastModified: file.lastModified } satisfies StoredDocument, "current");
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  database.close();
}

async function readLocalDocument() {
  const database = await openDocumentDatabase();
  const record = await new Promise<StoredDocument | undefined>((resolve, reject) => {
    const request = database.transaction(DOCUMENT_STORE, "readonly").objectStore(DOCUMENT_STORE).get("current");
    request.onsuccess = () => resolve(request.result as StoredDocument | undefined);
    request.onerror = () => reject(request.error);
  });
  database.close();
  return record ? new File([record.blob], record.name, { type: record.type, lastModified: record.lastModified }) : null;
}

async function removeLocalDocument() {
  const database = await openDocumentDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(DOCUMENT_STORE, "readwrite");
    transaction.objectStore(DOCUMENT_STORE).delete("current");
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  database.close();
}

const starterCorners: Corner[] = [
  [25.28806, 82.97291],
  [25.28834, 82.97431],
  [25.28691, 82.97463],
  [25.28667, 82.97317],
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

function PdfPagePreview({ document, page, clear, onPageCount }: { document: UploadedDocument; page: number; clear: boolean; onPageCount: (count: number) => void }) {
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const onPageCountRef = useRef(onPageCount);
  onPageCountRef.current = onPageCount;

  useEffect(() => {
    let disposed = false;
    let renderTask: { cancel: () => void; promise: Promise<unknown> } | null = null;
    setLoading(true);
    setImageUrl(null);
    setErrorMessage(null);
    void import("pdfjs-dist").then(async (pdfjs) => {
      if (disposed) return;
      // Keep the worker on the same origin so blob-backed local PDFs render in
      // development, packaged Sites builds, and strict private deployments.
      pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
      const pdf = await pdfjs.getDocument({ url: document.url }).promise;
      if (disposed) return;
      onPageCountRef.current(pdf.numPages);
      const safePage = Math.min(page, pdf.numPages);
      const pdfPage = await pdf.getPage(safePage);
      const viewport = pdfPage.getViewport({ scale: 1.75 });
      const canvas = window.document.createElement("canvas");
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      const context = canvas.getContext("2d", { willReadFrequently: clear });
      if (!context) return;
      renderTask = pdfPage.render({ canvas, canvasContext: context, viewport });
      await renderTask.promise;
      if (clear) {
        const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
        for (let index = 0; index < pixels.data.length; index += 4) {
          const red = pixels.data[index];
          const green = pixels.data[index + 1];
          const blue = pixels.data[index + 2];
          const lightness = red * 0.299 + green * 0.587 + blue * 0.114;
          const blueInk = blue > red * 1.08 && blue > green * 1.04 && lightness < 205;
          if (lightness > 202) {
            const whitening = Math.min(1, (lightness - 202) / 38 + 0.42);
            pixels.data[index] = Math.round(red + (255 - red) * whitening);
            pixels.data[index + 1] = Math.round(green + (255 - green) * whitening);
            pixels.data[index + 2] = Math.round(blue + (255 - blue) * whitening);
          } else if (blueInk) {
            pixels.data[index] = Math.round(red * 0.72);
            pixels.data[index + 1] = Math.round(green * 0.72);
            pixels.data[index + 2] = Math.round(Math.min(255, blue * 0.9));
          } else {
            const darkening = lightness < 125 ? 0.68 : 0.82;
            pixels.data[index] = Math.round(red * darkening);
            pixels.data[index + 1] = Math.round(green * darkening);
            pixels.data[index + 2] = Math.round(blue * darkening);
          }
        }
        context.putImageData(pixels, 0, 0);
      }
      if (!disposed) {
        setImageUrl(canvas.toDataURL("image/jpeg", clear ? 0.94 : 0.9));
        setLoading(false);
      }
    }).catch((error: unknown) => {
      if (!disposed) {
        setLoading(false);
        setErrorMessage(error instanceof Error ? error.message : "Unable to render this PDF");
      }
    });
    return () => {
      disposed = true;
      renderTask?.cancel();
    };
  }, [clear, document.url, page]);

  return (
    <div className={`uploaded-paper uploaded-pdf rendered-pdf ${clear ? "clear-preview" : ""}`}>
      {loading ? <div className="page-render-loading"><ScanLine size={24} /><span>Rendering page {page}</span></div> : imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={imageUrl} alt={`${clear ? "Cleaned" : "Original"} PDF page ${page}`} />
      ) : <div className="page-render-loading"><FileText size={24} /><span>Preview unavailable</span>{errorMessage && <small>{errorMessage}</small>}</div>}
      {clear && <div className="enhancement-note"><WandSparkles size={13} /> Background cleaned · ink strengthened · page {page}</div>}
    </div>
  );
}

function DocumentPreview({ document, page, clear = false, onPageCount }: { document: UploadedDocument; page: number; clear?: boolean; onPageCount: (count: number) => void }) {
  if (document.kind === "pdf") {
    return <PdfPagePreview document={document} page={page} clear={clear} onPageCount={onPageCount} />;
  }

  return (
    <div className={`uploaded-paper uploaded-image ${clear ? "clear-preview" : ""}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={clear ? document.clearUrl : document.url} alt={`${clear ? "Enhanced" : "Original"} uploaded document`} />
      {clear && <div className="enhancement-note"><WandSparkles size={13} /> Cleaned locally in your browser</div>}
    </div>
  );
}

function EmptyDocument({ onUpload, clear = false }: { onUpload: () => void; clear?: boolean }) {
  return (
    <button className="empty-document" onClick={onUpload}>
      <div className="empty-document-icon">{clear ? <WandSparkles size={24} /> : <Upload size={24} />}</div>
      <strong>{clear ? "Your clear document appears here" : "Drop in a PDF or image"}</strong>
      <span>{clear ? "Vellum preserves page order, spacing, and searchable text." : "PDF, PNG, JPG or TIFF · up to 100 MB"}</span>
      {!clear && <b>Choose document</b>}
    </button>
  );
}

const verificationRows: Array<{
  parameter: string;
  document: string;
  portal: string;
  comparisonOne: string;
  report: string;
  comparisonTwo: string;
  statusOne: VerificationStatus;
  statusTwo: VerificationStatus;
}> = [
  {
    parameter: "Ownership",
    document: "Seller: Rakesh Kumar Sharma\nBuyer: Meera Sharma",
    portal: "Meera Sharma\nMutation entry verified",
    comparisonOne: "Buyer matches current holder\nCross-script match: 99.4%",
    report: "Owner / applicant: Meera Sharma",
    comparisonTwo: "Current owner confirmed on site",
    statusOne: "positive",
    statusTwo: "positive",
  },
  {
    parameter: "Address",
    document: "Khasra 214/3, Bhadaini\nSadar, Varanasi, UP",
    portal: "Khasra 214/3, Bhadaini\nTehsil Sadar, Varanasi",
    comparisonOne: "All material fields match",
    report: "Plot 214/3, Mauza Bhadaini\nVaranasi · 221005",
    comparisonTwo: "Plot and locality aligned",
    statusOne: "positive",
    statusTwo: "positive",
  },
  {
    parameter: "Area / size",
    document: "1,856 sq.ft\n172.43 sq.m · residential",
    portal: "172.43 sq.m\n1,856 sq.ft converted",
    comparisonOne: "0.0% deviation",
    report: "Measured: 1,820 sq.ft\nLaser survey completed",
    comparisonTwo: "1.94% deviation · within tolerance",
    statusOne: "positive",
    statusTwo: "positive",
  },
  {
    parameter: "Boundary · E/W/N/S",
    document: "E: House 214/4\nW: 18 ft municipal lane\nN: Sharma house · S: vacant plot",
    portal: "E: Khasra 214/4\nW: 20 ft public lane\nN: Abadi · S: Khasra 215",
    comparisonOne: "West access width differs by 2 ft",
    report: "E: adjoining house\nW: 20 ft lane\nN: residence · S: open parcel",
    comparisonTwo: "Physical sides align with record",
    statusOne: "refer",
    statusTwo: "positive",
  },
  {
    parameter: "Geo-coordinates",
    document: "Not stated in deed\nDerived from cadastral overlay",
    portal: "25.287310° N\n82.973840° E",
    comparisonOne: "Portal centroid mapped to parcel",
    report: "25.287512° N\n82.973961° E · 9 geotagged photos",
    comparisonTwo: "25.5 m deviation · within tolerance",
    statusOne: "refer",
    statusTwo: "positive",
  },
];

function ResultBadge({ status, compact = false }: { status: VerificationStatus; compact?: boolean }) {
  const content = {
    positive: { icon: <CircleCheck size={compact ? 13 : 15} />, label: "Positive" },
    refer: { icon: <AlertTriangle size={compact ? 13 : 15} />, label: "Refer" },
    negative: { icon: <CircleX size={compact ? 13 : 15} />, label: "Negative" },
  }[status];
  return <span className={`result-badge ${status} ${compact ? "compact" : ""}`}>{content.icon}{content.label}</span>;
}

function VerificationWorkspace() {
  const [running, setRunning] = useState(false);
  const [activeDetail, setActiveDetail] = useState("matrix");
  const [sourceProgress, setSourceProgress] = useState(100);

  const rerun = () => {
    setRunning(true);
    setSourceProgress(8);
    let value = 8;
    const timer = window.setInterval(() => {
      value += 11;
      setSourceProgress(Math.min(value, 100));
      if (value >= 100) {
        window.clearInterval(timer);
        setRunning(false);
      }
    }, 170);
  };

  const exportJson = () => {
    const payload = {
      applicationId: "SHFL0021847",
      applicant: "Meera Sharma",
      deed: "Sale Deed SD-47/2025/1182",
      property: { khasra: "214/3", village: "Bhadaini", tehsil: "Sadar", district: "Varanasi", state: "UP" },
      results: verificationRows,
      aggregate: { positive: 8, refer: 2, negative: 0, recommendation: "HOLD", score: 90 },
      generatedAt: new Date().toISOString(),
    };
    const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "SHFL0021847-property-verification.json";
    link.click();
    URL.revokeObjectURL(url);
  };

  const exportReport = async () => {
    const { jsPDF } = await import("jspdf");
    const pdf = new jsPDF({ unit: "pt", format: "a3", orientation: "landscape" });
    const width = pdf.internal.pageSize.getWidth();
    pdf.setFillColor(28, 49, 84);
    pdf.rect(0, 0, width, 70, "F");
    pdf.setFillColor(239, 111, 38);
    pdf.rect(width - 245, 0, 245, 70, "F");
    pdf.setTextColor(255, 255, 255);
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(21);
    pdf.text("Sitaara Property Verification Report", 34, 31);
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(9);
    pdf.text("Three-source verification · Application SHFL0021847", 34, 50);
    pdf.text(`Generated ${new Date().toLocaleDateString("en-IN")}`, width - 218, 31);
    pdf.text("Recommendation: HOLD", width - 218, 49);

    pdf.setTextColor(26, 31, 29);
    pdf.setFontSize(8);
    const meta = [
      ["Applicant", "Meera Sharma"], ["Deed", "Sale Deed SD-47/2025/1182"],
      ["Property", "Khasra 214/3, Bhadaini, Sadar, Varanasi, UP"], ["Field visit", "22 Jul 2026"],
    ];
    meta.forEach(([label, value], index) => {
      const x = 34 + (index % 2) * 560;
      const y = 96 + Math.floor(index / 2) * 24;
      pdf.setFont("helvetica", "bold"); pdf.text(label.toUpperCase(), x, y);
      pdf.setFont("helvetica", "normal"); pdf.text(value, x + 75, y);
    });

    const columns = [34, 65, 165, 335, 505, 650, 820, 965, 1145];
    const headers = ["Sr.", "Parameter", "Property document (OCR)", "Government portal", "Doc vs portal", "Technical report", "Portal vs tech"];
    const tableTop = 155;
    pdf.setFillColor(28, 49, 84);
    pdf.rect(columns[0], tableTop, columns[7] - columns[0], 34, "F");
    pdf.setTextColor(255,255,255); pdf.setFont("helvetica","bold"); pdf.setFontSize(7);
    headers.forEach((header, i) => pdf.text(header, columns[i] + 5, tableTop + 20));
    verificationRows.forEach((row, index) => {
      const y = tableTop + 34 + index * 86;
      const cells = [String(index + 1), row.parameter, row.document, row.portal, row.comparisonOne, row.report, row.comparisonTwo];
      const statuses: Array<VerificationStatus | null> = [null, null, null, null, row.statusOne, null, row.statusTwo];
      cells.forEach((cell, cellIndex) => {
        const cellWidth = columns[cellIndex + 1] - columns[cellIndex];
        const status = statuses[cellIndex];
        if (status) {
          const color = status === "positive" ? [228,244,235] : status === "refer" ? [255,244,214] : [255,229,226];
          pdf.setFillColor(color[0], color[1], color[2]);
        } else pdf.setFillColor(index % 2 ? 248 : 240, index % 2 ? 249 : 244, index % 2 ? 247 : 249);
        pdf.rect(columns[cellIndex], y, cellWidth, 86, "FD");
        pdf.setTextColor(32,39,35); pdf.setFont("helvetica", cellIndex === 1 || status ? "bold" : "normal"); pdf.setFontSize(6.7);
        const lines = pdf.splitTextToSize(cell.replaceAll("\n", " · "), cellWidth - 10);
        pdf.text(lines.slice(0, 7), columns[cellIndex] + 5, y + 14);
      });
    });
    const scoreY = tableTop + 34 + verificationRows.length * 86 + 20;
    pdf.setFillColor(255,244,214); pdf.rect(34, scoreY, 1111, 45, "F");
    pdf.setTextColor(120,73,5); pdf.setFont("helvetica","bold"); pdf.setFontSize(11);
    pdf.text("AGGREGATE  8 POSITIVE  ·  2 REFER  ·  0 NEGATIVE     RECOMMENDATION: HOLD", 54, scoreY + 28);
    pdf.save("SHFL0021847-property-verification.pdf");
  };

  return (
    <section className="verification-workspace" aria-labelledby="verification-title">
      <header className="case-header">
        <div className="case-identity">
          <div className="case-breadcrumb"><span>Applications</span><ChevronRight size={12} /><strong>SHFL0021847</strong></div>
          <div className="case-title-row"><h1 id="verification-title">Meera Sharma</h1><span className="case-verdict"><AlertTriangle size={14} /> Hold for review</span></div>
          <p>Sale Deed · Khasra 214/3 · Bhadaini, Sadar, Varanasi, Uttar Pradesh</p>
        </div>
        <div className="case-actions">
          <button className="button button-ghost" onClick={exportJson}><FileJson size={16} /> JSON</button>
          <button className="button button-ghost" onClick={rerun} disabled={running}><RefreshCw size={16} className={running ? "spinning" : ""} /> {running ? "Verifying" : "Re-run"}</button>
          <button className="button button-primary" onClick={exportReport}><ArrowDownToLine size={16} /> Download report</button>
        </div>
      </header>

      <div className="case-meta-strip">
        <div><span>Application</span><strong>SHFL0021847</strong></div>
        <div><span>Deed no.</span><strong>SD-47/2025/1182</strong></div>
        <div><span>Product</span><strong>HL · Construction</strong></div>
        <div><span>Field visit</span><strong>22 Jul 2026</strong></div>
        <div><span>Last verified</span><strong>Just now</strong></div>
      </div>

      <div className="source-grid">
        <article className="source-card"><div className="source-card-icon"><FileText size={19} /></div><div><span>Property document</span><strong>Sale deed · OCR complete</strong><small>Hindi + English · 21 fields extracted</small></div><ResultBadge status="positive" compact /></article>
        <article className="source-card"><div className="source-card-icon"><Database size={19} /></div><div><span>Government record</span><strong>UP Bhulekh + BhuNaksha</strong><small>Khatauni and parcel matched · cached now</small></div><ResultBadge status="positive" compact /></article>
        <article className="source-card"><div className="source-card-icon"><ScanLine size={19} /></div><div><span>Technical valuation</span><strong>TVR parsed · 9 site photos</strong><small>Field report dated 22 Jul 2026</small></div><ResultBadge status="positive" compact /></article>
        {running && <div className="source-progress"><i style={{width:`${sourceProgress}%`}} /></div>}
      </div>

      <div className="verification-tabs" role="tablist">
        {[['matrix','Comparison matrix'],['evidence','Evidence & map'],['risk','Risk flags']].map(([id,label]) => <button key={id} className={activeDetail === id ? "active" : ""} onClick={() => setActiveDetail(id)}>{label}</button>)}
      </div>

      {activeDetail === "matrix" && (
        <div className="verification-main-grid">
          <div className="matrix-panel">
            <div className="matrix-heading"><div><h2>Three-source comparison</h2><p>Two independent checks per parameter, using the BRD tolerance rules.</p></div><div className="score-mini"><strong>90%</strong><span>verification score</span></div></div>
            <div className="matrix-scroll">
              <table className="verification-matrix">
                <thead><tr><th>Parameter</th><th>Property document · OCR</th><th>Government portal</th><th>Doc vs portal</th><th>Technical valuation</th><th>Portal vs tech</th></tr></thead>
                <tbody>{verificationRows.map((row) => <tr key={row.parameter}>
                  <th>{row.parameter}</th>
                  <td>{row.document.split("\n").map((line)=><span key={line}>{line}</span>)}</td>
                  <td>{row.portal.split("\n").map((line)=><span key={line}>{line}</span>)}</td>
                  <td className={`result-cell ${row.statusOne}`}><ResultBadge status={row.statusOne} compact /><p>{row.comparisonOne}</p></td>
                  <td>{row.report.split("\n").map((line)=><span key={line}>{line}</span>)}</td>
                  <td className={`result-cell ${row.statusTwo}`}><ResultBadge status={row.statusTwo} compact /><p>{row.comparisonTwo}</p></td>
                </tr>)}</tbody>
              </table>
            </div>
          </div>
          <aside className="decision-panel">
            <div className="decision-top"><span>Aggregate decision</span><strong>HOLD</strong><p>Eight positive checks, two referrals, and no critical mismatches.</p></div>
            <div className="decision-counts"><div className="positive"><b>08</b><span>Positive</span></div><div className="refer"><b>02</b><span>Refer</span></div><div className="negative"><b>00</b><span>Negative</span></div></div>
            <div className="review-reason"><AlertTriangle size={17} /><div><strong>Analyst review required</strong><span>Confirm the 2 ft access-width variance and cadastral centroid source.</span></div></div>
            <div className="decision-rule"><span>Decision rule</span><strong>Hold when ≥1 Refer and no Negative</strong></div>
            <button className="approve-case"><CircleCheck size={16} /> Mark reviewed and approve</button>
          </aside>
        </div>
      )}

      {activeDetail === "evidence" && (
        <div className="evidence-grid">
          <div className="evidence-map-card"><div className="evidence-card-head"><div><h2>Parcel evidence</h2><p>Khasra 214/3 · cadastral boundary aligned to the basemap.</p></div><span>±2.4 m overlay estimate</span></div><div className="evidence-map"><ParcelMap opacity={0.42} corners={starterCorners} onCornerChange={() => undefined} /></div></div>
          <div className="evidence-list"><h2>Coordinate chain</h2><div><span>01</span><p><strong>Portal centroid</strong><small>25.287310° N, 82.973840° E</small></p><Check size={15} /></div><div><span>02</span><p><strong>Technical visit GPS</strong><small>25.5 m deviation · within tolerance</small></p><Check size={15} /></div><div><span>03</span><p><strong>Ground evidence</strong><small>9 photos within a 30 m radius</small></p><Check size={15} /></div><div className="evidence-caveat"><ShieldAlert size={17} /><p><strong>Legal caution</strong><small>Cadastral overlay is supporting evidence. Revenue records and field verification remain authoritative.</small></p></div></div>
        </div>
      )}

      {activeDetail === "risk" && (
        <div className="risk-workspace"><div className="risk-header"><div><h2>Auto-detected risk flags</h2><p>Flags remain separate from the five comparison parameters.</p></div><span>3 open items</span></div>{[
          ["Access width variance", "Field measurement is 2 ft wider than the registered deed", "refer"],
          ["Centroid-based coordinates", "Replace portal centroid with an authenticated survey point when available", "refer"],
          ["Mutation is recent", "Review the July mutation entry before final approval", "refer"],
        ].map(([title,body,status],index)=><article className={`risk-item ${status}`} key={title}><span>{String(index+1).padStart(2,"0")}</span><div><strong>{title}</strong><p>{body}</p></div><ResultBadge status={status as VerificationStatus} compact /></article>)}</div>
      )}
    </section>
  );
}

function ScanWorkspace() {
  const uploadRef = useRef<HTMLInputElement>(null);
  const uploadUrlRef = useRef<string | null>(null);
  const processingTimerRef = useRef<number | null>(null);
  const [fileName, setFileName] = useState("RTC_Survey_118_2B.pdf");
  const [fileMeta, setFileMeta] = useState("8 pages · 14.8 MB");
  const [uploadedDocument, setUploadedDocument] = useState<UploadedDocument | null>(null);
  const [isEmpty, setIsEmpty] = useState(false);
  const [scanState, setScanState] = useState<ScanState>("ready");
  const [progress, setProgress] = useState(100);
  const [showBlocks, setShowBlocks] = useState(false);
  const [page, setPage] = useState(1);
  const [pageCount, setPageCount] = useState(8);
  const [languageMode, setLanguageMode] = useState("auto-india");

  useEffect(() => () => {
    if (processingTimerRef.current) window.clearInterval(processingTimerRef.current);
    if (uploadUrlRef.current) URL.revokeObjectURL(uploadUrlRef.current);
  }, []);

  const enhanceImage = async (file: File) => {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 1800 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const context = canvas.getContext("2d");
    if (!context) return "";
    context.fillStyle = "#fffef9";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.filter = "grayscale(0.12) contrast(1.24) brightness(1.07)";
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    return canvas.toDataURL("image/jpeg", 0.94);
  };

  const processFile = async (file?: File, options: { persist?: boolean; animate?: boolean } = {}) => {
    if (!file) return;
    const persist = options.persist ?? true;
    const animate = options.animate ?? true;
    if (processingTimerRef.current) window.clearInterval(processingTimerRef.current);
    if (uploadUrlRef.current) URL.revokeObjectURL(uploadUrlRef.current);
    const objectUrl = URL.createObjectURL(file);
    uploadUrlRef.current = objectUrl;
    const kind = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf") ? "pdf" : "image";
    const size = file.size >= 1024 * 1024 ? `${(file.size / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(file.size / 1024))} KB`;
    setFileName(file.name);
    setFileMeta(`${kind === "pdf" ? "PDF document" : "Image document"} · ${size}`);
    setIsEmpty(false);
    setPage(1);
    setPageCount(kind === "pdf" ? 1 : 1);
    setUploadedDocument({ url: objectUrl, clearUrl: objectUrl, kind, name: file.name, size });
    setScanState(animate ? "processing" : "ready");
    setProgress(animate ? 7 : 100);
    if (persist) {
      window.localStorage.removeItem("sitaara-document-empty");
      void saveDocumentLocally(file).catch(() => undefined);
    }
    if (kind === "image") {
      const clearUrl = await enhanceImage(file);
      setUploadedDocument({ url: objectUrl, clearUrl: clearUrl || objectUrl, kind, name: file.name, size });
    }
    if (!animate) return;
    let value = 7;
    const timer = window.setInterval(() => {
      value += Math.ceil(Math.random() * 12);
      setProgress(Math.min(value, 100));
      if (value >= 100) {
        window.clearInterval(timer);
        processingTimerRef.current = null;
        setScanState("ready");
      }
    }, 180);
    processingTimerRef.current = timer;
  };

  useEffect(() => {
    let cancelled = false;
    void readLocalDocument().then((file) => {
      if (cancelled) return;
      if (file) return processFile(file, { persist: false, animate: false });
      if (window.localStorage.getItem("sitaara-document-empty") === "true") setIsEmpty(true);
    }).catch(() => undefined);
    return () => { cancelled = true; };
    // The restore runs once whenever the Document Lab workspace mounts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const removeUpload = () => {
    if (processingTimerRef.current) window.clearInterval(processingTimerRef.current);
    processingTimerRef.current = null;
    if (uploadUrlRef.current) URL.revokeObjectURL(uploadUrlRef.current);
    uploadUrlRef.current = null;
    setUploadedDocument(null);
    setFileName("No document loaded");
    setFileMeta("Upload a PDF or image to begin");
    setScanState("ready");
    setProgress(0);
    setIsEmpty(true);
    setPage(1);
    setPageCount(0);
    window.localStorage.setItem("sitaara-document-empty", "true");
    void removeLocalDocument().catch(() => undefined);
    if (uploadRef.current) uploadRef.current.value = "";
  };

  const exportPdf = async () => {
    const { jsPDF } = await import("jspdf");
    if (uploadedDocument?.kind === "image") {
      const image = new Image();
      image.src = uploadedDocument.clearUrl;
      await image.decode();
      const landscape = image.width > image.height;
      const pdf = new jsPDF({ unit: "pt", format: "a4", orientation: landscape ? "landscape" : "portrait" });
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const ratio = Math.min((pageWidth - 48) / image.width, (pageHeight - 48) / image.height);
      const width = image.width * ratio;
      const height = image.height * ratio;
      pdf.addImage(uploadedDocument.clearUrl, "JPEG", (pageWidth - width) / 2, (pageHeight - height) / 2, width, height);
      pdf.save(`Vellum-clear-${fileName.replace(/\.[^/.]+$/, "")}.pdf`);
      return;
    }
    if (uploadedDocument?.kind === "pdf") {
      const link = document.createElement("a");
      link.href = uploadedDocument.url;
      link.download = `Vellum-clear-${fileName}`;
      link.click();
      return;
    }
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
          {!isEmpty && <button className="button button-danger" type="button" onClick={removeUpload}><Trash2 size={17} /> Delete document</button>}
          <button className="button button-primary" onClick={exportPdf} disabled={scanState === "processing" || isEmpty}><ArrowDownToLine size={17} /> Export clear PDF</button>
        </div>
      </header>

      <input
        ref={uploadRef}
        type="file"
        accept="application/pdf,image/*"
        hidden
        onChange={(event) => void processFile(event.target.files?.[0])}
      />

      <div className="status-strip">
        <div className="file-summary">
          <div className="file-icon"><FileText size={18} /></div>
          <div><strong>{fileName}</strong><span>{fileMeta}</span></div>
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
        <label className="language-control">
          <Languages size={15} />
          <span>OCR language</span>
          <select value={languageMode} onChange={(event) => setLanguageMode(event.target.value)}>
            <option value="auto-india">Auto · India</option>
            <option value="devanagari">Hindi / Marathi / Sanskrit</option>
            <option value="tamil">Tamil</option>
            <option value="telugu">Telugu</option>
            <option value="kannada">Kannada</option>
            <option value="bengali">Bengali / Assamese</option>
            <option value="gujarati">Gujarati</option>
            <option value="gurmukhi">Punjabi · Gurmukhi</option>
            <option value="malayalam">Malayalam</option>
            <option value="odia">Odia</option>
            <option value="urdu">Urdu</option>
            <option value="english">English</option>
          </select>
        </label>
        {!isEmpty && (
          <button className="delete-upload" type="button" onClick={removeUpload} aria-label={`Delete ${fileName}`} title="Delete uploaded document">
            <Trash2 size={15} /><span>Delete</span>
          </button>
        )}
      </div>

      <div className="document-stage">
        <aside className="page-rail" aria-label="Document pages">
          <div className="rail-title"><span>Pages</span><strong>{String(pageCount).padStart(2, "0")}</strong></div>
          {Array.from({ length: Math.min(4, Math.max(1, pageCount)) }, (_, index) => index + 1).map((item) => (
            <button key={item} className={`page-thumb ${page === item ? "active" : ""}`} onClick={() => setPage(item)}>
              <div className="mini-paper"><i /><i /><i /><i /></div>
              <span>{String(item).padStart(2, "0")}</span>
            </button>
          ))}
          {pageCount > 4 && <button className="more-pages">+{pageCount - 4}</button>}
        </aside>

        <div className="comparison-area">
          {scanState === "processing" && (
            <div className="processing-overlay">
              <div className="processing-orbit"><ScanLine /></div>
              <strong>Rebuilding page structure</strong>
              <span>{languageMode === "auto-india" ? "Auto script routing · 12 Indian scripts · CPU" : `${languageMode} recognition · PP-StructureV3 · CPU`}</span>
              <div className="progress-track"><i style={{ width: `${progress}%` }} /></div>
              <b>{progress}%</b>
            </div>
          )}
          <div className="page-column">
            <div className="column-head"><span>Original scan</span><small>Source preserved</small></div>
            {uploadedDocument ? <DocumentPreview document={uploadedDocument} page={page} onPageCount={(count) => { setPageCount(count); setFileMeta(`${count} page${count === 1 ? "" : "s"} · ${uploadedDocument.size}`); }} /> : isEmpty ? <EmptyDocument onUpload={() => uploadRef.current?.click()} /> : <OriginalPage />}
          </div>
          <div className="compare-divider"><div><ArrowLeftRight size={15} /></div></div>
          <div className="page-column">
            <div className="column-head"><span>Clear document</span><small className="success-text"><Check size={12} /> Searchable</small></div>
            {uploadedDocument ? <DocumentPreview document={uploadedDocument} page={page} clear onPageCount={(count) => { setPageCount(count); setFileMeta(`${count} page${count === 1 ? "" : "s"} · ${uploadedDocument.size}`); }} /> : isEmpty ? <EmptyDocument clear onUpload={() => uploadRef.current?.click()} /> : <RestoredPage showBlocks={showBlocks} />}
          </div>
        </div>

        <aside className="inspector">
          <div className="inspector-head"><span>Document health</span><Sparkles size={16} /></div>
          <ConfidenceRing />
          <div className="metric-list">
            <div><span>Reading order</span><strong>Verified</strong></div>
            <div><span>Tables found</span><strong>02</strong></div>
            <div><span>Languages</span><strong>{languageMode === "auto-india" ? "AUTO · INDIA" : languageMode.toUpperCase()}</strong></div>
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
      polygon.bindTooltip("Khasra 214/3 · 1,856 sq.ft", { permanent: true, direction: "center", className: "parcel-label" });
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
  const [surveyNumber, setSurveyNumber] = useState("214/3");
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
            <label>Village<input defaultValue="Bhadaini" /></label>
            <label>Tehsil<input defaultValue="Sadar" /></label>
          </div>
          <label>District<input defaultValue="Varanasi" /></label>
          <button className="button button-primary locate-button" onClick={locate}><Search size={17} /> {located ? "Locate plot" : "Matching record…"}</button>
          <div className="source-note"><CircleHelp size={16} /><p><strong>Registry-aware, map-safe</strong><span>OpenStreetMap is the basemap. Legal parcel geometry must come from a survey record, GeoJSON, or confirmed corner points.</span></p></div>
          {recordOpen && located && (
            <div className="matched-record">
              <button className="record-close" aria-label="Close record" onClick={() => setRecordOpen(false)}><X size={14} /></button>
              <div className="match-label"><Check size={12} /> Matched sample</div>
              <h3>Survey {surveyNumber}</h3>
              <p>Bhadaini · Khata 84</p>
              <div className="record-metrics"><span><b>1,856</b> sq.ft</span><span><b>170.4</b> m perimeter</span></div>
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
        <div className="modal-copy"><div className="eyebrow"><Sparkles size={13} /> Enterprise operations</div><h2>Verification at<br /><em>portfolio scale.</em></h2><p>Connect state portals, protect regulated data, and deliver each credit-ready report in under three minutes.</p></div>
        <div className="plan-card">
          <div className="plan-price"><span>Production controls</span><strong>500+<small> concurrent cases</small></strong></div>
          {["State portal connector registry", "24-hour evidence cache", "PII-masked audit trail", "SFTP and S3 report delivery"].map((item) => <div className="plan-feature" key={item}><Check size={15} />{item}</div>)}
          <button className="button button-primary">Configure deployment</button>
          <small>Secrets-manager ready · Role-based access</small>
        </div>
      </div>
    </div>
  );
}

export default function Home() {
  const [view, setView] = useState<View>("verification");
  const [viewRestored, setViewRestored] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [upgradeOpen, setUpgradeOpen] = useState(false);

  useEffect(() => {
    const savedView = window.localStorage.getItem("sitaara-active-view");
    if (savedView === "verification" || savedView === "scan" || savedView === "map") setView(savedView);
    setViewRestored(true);
  }, []);

  useEffect(() => {
    if (viewRestored) window.localStorage.setItem("sitaara-active-view", view);
  }, [view, viewRestored]);

  return (
    <main className="app-shell">
      <aside className={`sidebar ${menuOpen ? "open" : ""}`}>
        <div className="sidebar-brand"><BrandMark /><div><strong>Sitaara Verify</strong><span>Property intelligence</span></div></div>
        <nav aria-label="Primary navigation">
          <button className={view === "verification" ? "active" : ""} onClick={() => { setView("verification"); setMenuOpen(false); }}><LayoutDashboard size={18} /><span>Verification</span><ChevronRight size={14} /></button>
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
          <strong>Production controls</strong>
          <span>Portal connectors, audit trails, SFTP/S3 delivery and peak-load scaling.</span>
          <button onClick={() => setUpgradeOpen(true)}>Configure <ChevronRight size={14} /></button>
        </div>
        <div className="user-card"><div>AK</div><p><strong>Arjun Kumar</strong><span>Trial · 11 days left</span></p><ChevronRight size={14} /></div>
      </aside>

      <div className="main-panel">
        <div className="mobile-topbar"><button onClick={() => setMenuOpen((value) => !value)} aria-label="Open menu"><Menu /></button><div><BrandMark /><strong>Sitaara Verify</strong></div><button onClick={() => setUpgradeOpen(true)}><Sparkles size={17} /></button></div>
        {view === "verification" ? <VerificationWorkspace /> : view === "scan" ? <ScanWorkspace /> : <MapWorkspace />}
      </div>
      {menuOpen && <button className="mobile-scrim" aria-label="Close menu" onClick={() => setMenuOpen(false)} />}
      {upgradeOpen && <UpgradeModal onClose={() => setUpgradeOpen(false)} />}
    </main>
  );
}
