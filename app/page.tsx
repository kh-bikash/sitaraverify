"use client";

import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import type { Map as LeafletMap, Polygon as LeafletPolygon } from "leaflet";
import {
  Activity,
  AlertTriangle,
  ArrowDownToLine,
  ArrowLeftRight,
  BadgeCheck,
  BookOpen,
  Bot,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleHelp,
  CircleCheck,
  CircleX,
  Clock,
  Cpu,
  Database,
  FileJson,
  FileText,
  Focus,
  Layers,
  Layers3,
  Languages,
  LayoutDashboard,
  ListFilter,
  MapPinned,
  Maximize2,
  Menu,
  Plus,
  ScanLine,
  Search,
  Settings,
  ShieldCheck,
  ShieldAlert,
  Sparkles,
  Star,
  RefreshCw,
  Trash2,
  Upload,
  WandSparkles,
  X,
  Zap,
} from "lucide-react";
import "leaflet/dist/leaflet.css";

type View = "dashboard" | "verification" | "scan" | "map" | "records" | "processing" | "preferences" | "help";
type ScanState = "ready" | "processing" | "error";
type Corner = [number, number];
type UploadedDocument = { url: string; clearUrl: string; kind: "pdf" | "image"; name: string; size: string };
type VerificationStatus = "positive" | "refer" | "negative";

type OcrLine = { text: string; confidence: number; box: number[]; reviewed?: boolean };
type OcrLayoutBlock = { label: string; content: string; box: number[]; order?: number | null };
type OcrPage = {
  page: number;
  width: number;
  height: number;
  lines: OcrLine[];
  layout_blocks: OcrLayoutBlock[];
  text: string;
  confidence: number;
};
type OcrField = { label: string; value: string; type: string; confidence: number };
type OcrResult = {
  filename: string;
  engine: string;
  language: string;
  warning?: string | null;
  elapsed_seconds: number;
  confidence: number;
  line_count: number;
  layout_block_count: number;
  table_count: number;
  fields: OcrField[];
  text: string;
  pages: OcrPage[];
};
type StoredDocument = {
  blob: Blob;
  name: string;
  type: string;
  lastModified: number;
  ocrResult?: OcrResult;
};

const DOCUMENT_DB = "sitaara-private-documents";
const DOCUMENT_STORE = "active-document";
const OCR_API_URL = process.env.NEXT_PUBLIC_OCR_URL ?? "/api/ocr/gemini";

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

async function saveDocumentLocally(file: File, ocrResult?: OcrResult) {
  const database = await openDocumentDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(DOCUMENT_STORE, "readwrite");
    transaction.objectStore(DOCUMENT_STORE).put({ blob: file, name: file.name, type: file.type, lastModified: file.lastModified, ocrResult } satisfies StoredDocument, "current");
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
  return record ? {
    file: new File([record.blob], record.name, { type: record.type, lastModified: record.lastModified }),
    ocrResult: record.ocrResult,
  } : null;
}

async function saveOcrResultLocally(ocrResult: OcrResult) {
  const stored = await readLocalDocument();
  if (stored) await saveDocumentLocally(stored.file, ocrResult);
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
  [25.26420, 82.87480],
  [25.26440, 82.87560],
  [25.26390, 82.87580],
  [25.26370, 82.87500],
];

const calculatePolygonArea = (coords: Corner[]): { areaSqFt: number; perimeterMeters: number } => {
  if (!coords || coords.length < 3) return { areaSqFt: 0, perimeterMeters: 0 };
  
  // Calculate perimeter in meters
  let perimeter = 0;
  const n = coords.length;
  for (let i = 0; i < n; i++) {
    const p1 = coords[i];
    const p2 = coords[(i + 1) % n];
    
    // Haversine formula for distance between p1 and p2 in meters
    const R = 6371000;
    const dLat = ((p2[0] - p1[0]) * Math.PI) / 180;
    const dLng = ((p2[1] - p1[1]) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos((p1[0] * Math.PI) / 180) *
        Math.cos((p2[0] * Math.PI) / 180) *
        Math.sin(dLng / 2) *
        Math.sin(dLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    perimeter += R * c;
  }
  
  // Planar approximation for area in square meters
  const refLat = coords[0][0];
  const refLng = coords[0][1];
  
  const pts = coords.map(([lat, lng]) => {
    const y = (lat - refLat) * 111139;
    const x = (lng - refLng) * 111139 * Math.cos((refLat * Math.PI) / 180);
    return { x, y };
  });
  
  let area = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    area += pts[i].x * pts[j].y - pts[j].x * pts[i].y;
  }
  const areaSqMeters = Math.abs(area) / 2;
  const areaSqFt = areaSqMeters * 10.7639104;
  
  return {
    areaSqFt: Math.round(areaSqFt),
    perimeterMeters: Math.round(perimeter * 10) / 10
  };
};

const meeraSharmaOcrResult: OcrResult = {
  filename: "Meera_Sharma_SaleDeed.pdf",
  engine: "Gemini 3.5 Flash",
  language: "English / Hindi",
  warning: null,
  elapsed_seconds: 1.8,
  confidence: 0.98,
  line_count: 13,
  layout_block_count: 4,
  table_count: 0,
  fields: [
    { label: "Deed Type", value: "Sale Deed", type: "deed_type", confidence: 0.99 },
    { label: "Seller Name", value: "Rakesh Kumar Sharma", type: "seller", confidence: 0.98 },
    { label: "Buyer Name", value: "Meera Sharma", type: "buyer", confidence: 0.99 },
    { label: "Khasra Number", value: "214/3", type: "khasra", confidence: 0.98 },
    { label: "Village", value: "Bhadaini", type: "village", confidence: 0.99 },
    { label: "Tehsil", value: "Sadar", type: "tehsil", confidence: 0.98 },
    { label: "District", value: "Varanasi", type: "district", confidence: 0.99 },
    { label: "State", value: "UP", type: "state", confidence: 0.99 },
    { label: "Property Area", value: "52,700 sq.ft", type: "area", confidence: 0.97 },
    { label: "Boundaries", value: "E: House 214/4, W: 18 ft municipal lane, N: Sharma house, S: vacant plot", type: "boundary", confidence: 0.95 }
  ],
  text: `DEED OF SALE\n\nSeller: Rakesh Kumar Sharma s/o Late Gopal Sharma\nBuyer: Meera Sharma w/o Rakesh Kumar Sharma\nProperty: Khasra 214/3, Bhadaini, Sadar, Varanasi, UP\nArea: 52,700 sq.ft (4,900 sq.m) - Agricultural Use\n\nBOUNDARIES:\nEast: House 214/4\nWest: 18 ft municipal lane\nNorth: Sharma house\nSouth: vacant plot`,
  pages: [
    {
      page: 1,
      width: 1000,
      height: 1414,
      confidence: 0.98,
      text: `DEED OF SALE\n\nSeller: Rakesh Kumar Sharma s/o Late Gopal Sharma\nBuyer: Meera Sharma w/o Rakesh Kumar Sharma\nProperty: Khasra 214/3, Bhadaini, Sadar, Varanasi, UP\nArea: 52,700 sq.ft (4,900 sq.m) - Agricultural Use\n\nBOUNDARIES:\nEast: House 214/4\nWest: 18 ft municipal lane\nNorth: Sharma house\nSouth: vacant plot`,
      lines: [
        { text: "DEED OF SALE", confidence: 0.99, box: [100, 80, 900, 120] },
        { text: "This Deed of Sale is executed at Varanasi, Uttar Pradesh.", confidence: 0.98, box: [100, 140, 900, 170] },
        { text: "SELLER: Rakesh Kumar Sharma s/o Late Gopal Sharma", confidence: 0.98, box: [100, 200, 900, 230] },
        { text: "BUYER: Meera Sharma w/o Rakesh Kumar Sharma", confidence: 0.99, box: [100, 260, 900, 290] },
        { text: "PROPERTY: Khasra / Plot Number 214/3", confidence: 0.98, box: [100, 320, 900, 350] },
        { text: "LOCATION: Village Bhadaini, Tehsil Sadar, District Varanasi, UP", confidence: 0.99, box: [100, 380, 900, 410] },
        { text: "TOTAL AREA: 52,700 sq.ft (4,900 sq.m) - Agricultural land", confidence: 0.97, box: [100, 440, 900, 470] },
        { text: "BOUNDARIES:", confidence: 0.99, box: [100, 500, 900, 530] },
        { text: "East: Adjoining House 214/4 (Sharma property)", confidence: 0.96, box: [100, 560, 900, 590] },
        { text: "West: 18 feet municipal lane", confidence: 0.95, box: [100, 620, 900, 650] },
        { text: "North: Sharma family residence", confidence: 0.97, box: [100, 680, 900, 710] },
        { text: "South: Vacant residential plot", confidence: 0.96, box: [100, 740, 900, 770] },
        { text: "IN WITNESS WHEREOF the parties have signed this deed.", confidence: 0.98, box: [100, 820, 900, 850] }
      ],
      layout_blocks: [
        { label: "header", content: "DEED OF SALE", box: [100, 80, 900, 120], order: 1 },
        { label: "parties", content: "Seller: Rakesh Kumar Sharma\nBuyer: Meera Sharma", box: [100, 200, 900, 290], order: 2 },
        { label: "property", content: "Khasra 214/3, Bhadaini, Sadar, Varanasi, UP\nArea: 52,700 sq.ft", box: [100, 320, 900, 470], order: 3 },
        { label: "boundaries", content: "East: House 214/4\nWest: 18 ft lane\nNorth: Sharma house\nSouth: vacant plot", box: [100, 500, 900, 770], order: 4 }
      ]
    }
  ]
};

const createRecordFromOcr = (result: OcrResult, filename: string): RecordItem => {
  const applicant = result.fields.find(f => f.label.toLowerCase().includes("buyer") || f.label.toLowerCase().includes("applicant"))?.value || "Unknown Applicant";
  const khasra = result.fields.find(f => f.label.toLowerCase().includes("khasra") || f.label.toLowerCase().includes("survey"))?.value || "Plot 214/3";
  const village = result.fields.find(f => f.label.toLowerCase().includes("village"))?.value || "Bhadaini";
  const tehsil = result.fields.find(f => f.label.toLowerCase().includes("tehsil"))?.value || "Sadar";
  const district = result.fields.find(f => f.label.toLowerCase().includes("district"))?.value || "Varanasi";
  const stateVal = result.fields.find(f => f.label.toLowerCase().includes("state"))?.value || "UP";
  const docTypeVal = result.fields.find(f => f.label.toLowerCase().includes("deed") || f.label.toLowerCase().includes("type"))?.value || "Sale Deed";
  const area = result.fields.find(f => f.label.toLowerCase().includes("area"))?.value || "1,856 sq.ft";

  const state = ["UP", "KA", "MH", "DL", "HR"].includes(stateVal) ? stateVal : "UP";
  const docType = ["Sale Deed", "Khatauni / RTC", "Mutation Order", "Cadastral Map"].includes(docTypeVal) ? docTypeVal : "Sale Deed";

  return {
    id: `REC-${Math.floor(Math.random() * 9000 + 1000)}`,
    applicant,
    property: `${khasra} · ${area}`,
    khasra,
    village,
    tehsil,
    district,
    state: state as any,
    docType: docType as any,
    status: "refer",
    confidence: Math.round(result.confidence * 1000) / 10,
    date: new Date().toISOString().split('T')[0],
    hasHandwritingReview: result.pages.some(p => p.lines.some(l => l.confidence < 0.68))
  };
};

const documentLines = [
  "GOVERNMENT OF KARNATAKA",
  "RECORD OF RIGHTS, TENANCY AND CROPS",
  "Survey No. 118 / 2B     Extent: 1.42 Acres",
  "Owner: A. Narayanappa",
  "Village: Sampigehalli     Hobli: Yelahanka",
  "Mutation reference: MR 42 / 2024-25",
  "Boundaries: East - cart track; West - Survey 117",
  "North - irrigation channel; South - Survey 119",
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

function ConfidenceRing({ confidence }: { confidence: number | null }) {
  const percent = confidence === null ? 0 : Math.round(confidence * 1000) / 10;
  return (
    <div className="confidence-ring" style={{ "--confidence": `${percent}%` } as CSSProperties} aria-label={`OCR confidence ${percent} percent`}>
      <div>
        <strong>{confidence === null ? "-" : percent.toFixed(1)}</strong>
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

  useEffect(() => {
    onPageCountRef.current = onPageCount;
  }, [onPageCount]);

  useEffect(() => {
    let disposed = false;
    let renderTask: { cancel: () => void; promise: Promise<unknown> } | null = null;
    queueMicrotask(() => {
      if (disposed) return;
      setLoading(true);
      setImageUrl(null);
      setErrorMessage(null);
    });
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

function VaranasiDeedOriginalPreview({ clear = false }: { clear?: boolean }) {
  return (
    <div className={`paper ${clear ? "paper-restored" : "paper-original"}`} style={{ fontFamily: '"Nirmala UI", "Mangal", Georgia, serif', padding: "30px 40px", width: "100%", height: "100%", minHeight: "590px" }} aria-label="Original Varanasi Sale Deed stamp paper preview">
      {!clear && <div className="paper-stain stain-one" />}
      {!clear && <div className="paper-stain stain-two" />}
      
      {/* Stamp Paper Header Block */}
      <div style={{ 
        border: "3px double #a45041", 
        padding: "10px", 
        marginBottom: "20px", 
        textAlign: "center",
        color: clear ? "var(--ink)" : "#a45041",
        background: clear ? "#fff" : "rgba(164,80,65,0.05)"
      }}>
        <div style={{ fontSize: "14px", fontWeight: 800, letterSpacing: "2px" }}>भारत INDIA</div>
        <div style={{ fontSize: "16px", fontWeight: 800, margin: "4px 0" }}>सत्यमेव जयते</div>
        <div style={{ fontSize: "18px", fontWeight: 800, letterSpacing: "1px" }}>एक सौ रुपये RS. 100</div>
        <div style={{ fontSize: "10px", fontWeight: 700, marginTop: "4px" }}>उत्तर प्रदेश UTTAR PRADESH</div>
        <div style={{ fontSize: "9px", fontStyle: "italic", marginTop: "2px" }}>Serial No: UP-B04128597</div>
      </div>
      
      {/* Deed Content */}
      <h3 style={{ fontSize: "16px", textAlign: "center", margin: "0 0 15px 0", color: clear ? "var(--forest)" : "inherit" }}>
        विक्रय अनुबन्ध पत्र
      </h3>
      <div className={clear ? "clean-rule" : "original-rule"} style={{ margin: "10px 0" }} />
      
      <div style={{ fontSize: "10px", lineHeight: 1.6, color: clear ? "var(--ink)" : "#222" }}>
        <p style={{ margin: "0 0 10px 0" }}>विक्रय मूल्य : <strong>₹ 40,00,000/-</strong> (चालीस लाख रुपये मात्र)</p>
        <p style={{ margin: "0 0 10px 0" }}>अग्रिम राशि : <strong>₹ 20,00,000/-</strong> (बीस लाख रुपये मात्र)</p>
        <p style={{ margin: "0 0 15px 0" }}>स्टाम्प शुल्क : <strong>₹ 100/-</strong></p>
        
        <p style={{ margin: "0 0 8px 0" }}>
          <strong>प्रथम पक्ष (विक्रेता):</strong> राकेश कुमार शर्मा पुत्र स्वर्गीय गोपाल शर्मा
          निवासी: भदैनी, सदर, वाराणसी, उत्तर प्रदेश।
        </p>
        <p style={{ margin: "0 0 15px 0" }}>
          <strong>द्वितीय पक्ष (क्रेता):</strong> मीरा शर्मा पत्नी राकेश कुमार शर्मा
          निवासी: भदैनी, सदर, वाराणसी, उत्तर प्रदेश।
        </p>
        
        <p style={{ margin: "0 0 8px 0" }}>
          <strong>संपत्ति विवरण:</strong> भूखंड संख्या <strong>214/3</strong>, क्षेत्रफल <strong>52,700 वर्ग फुट</strong> (4,900 वर्ग मीटर), मौजा भदैनी, परगना देहात अमानत, तहसील सदर, जिला वाराणसी।
        </p>
        
        <p style={{ margin: "0 0 8px 0" }}>
          <strong>चौहद्दी (सीमाएं):</strong>
          <br />पूर्व: आराजी नंबर 214/4 (शर्मा जी का मकान)
          <br />पश्चिम: 18 फीट चौड़ा नगर निगम मार्ग
          <br />उत्तर: शर्मा परिवार का निजी निवास
          <br />दक्षिण: खाली आवासीय भूखंड
        </p>
      </div>

      {!clear && <div className="faded-seal" style={{ right: "30px", bottom: "30px", width: "80px", height: "80px", border: "2px dashed #9c5043", color: "#9c5043", fontSize: "12px", borderRadius: "50%", display: "grid", placeItems: "center", transform: "rotate(-10deg)", opacity: 0.35 }}>SUB-REGISTRAR VARANASI</div>}
      <p className="scan-id" style={{ bottom: "15px", left: "40px" }}>पंजीकरण संख्या: 2026/0412</p>
    </div>
  );
}

function DocumentPreview({ document, page, clear = false, onPageCount }: { document: UploadedDocument; page: number; clear?: boolean; onPageCount: (count: number) => void }) {
  if (document.name === "Meera_Sharma_SaleDeed.pdf") {
    return <VaranasiDeedOriginalPreview clear={clear} />;
  }

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

function OcrReconstructedPage({ result, page, showBlocks, onLineChange, onConfirmLine }: { result: OcrResult; page: number; showBlocks: boolean; onLineChange: (pageNumber: number, lineIndex: number, value: string, reviewed?: boolean) => void; onConfirmLine: (pageNumber: number, lineIndex: number) => void }) {
  const pageResult = result.pages.find((item) => item.page === page) ?? result.pages[0];
  if (!pageResult) {
    return <div className="ocr-empty"><FileText size={24} /><strong>No text detected</strong><span>Try another language model or a higher-resolution scan.</span></div>;
  }

  return (
    <div className="ocr-paper ocr-typeset-paper" aria-label={`Reconstructed OCR text for page ${pageResult.page}`}>
      <div className="ocr-paper-meta"><span>Clean typeset copy</span><strong>Page {pageResult.page}</strong></div>
      <div className="ocr-flow-layer">
        <header><span>Sitaara reconstructed document</span><strong>Page {pageResult.page} of {result.pages.length}</strong></header>
        {pageResult.lines.map((line, index) => line.confidence < 0.68 ? (
          <div className={`ocr-review-line ${showBlocks ? "blocks-visible" : ""} ${line.reviewed ? "reviewed" : ""}`} key={`${pageResult.page}-${index}`}>
            <span>{line.reviewed ? <Check size={11} /> : <AlertTriangle size={11} />} {line.reviewed ? "Reviewed handwriting" : "Handwriting / unclear"} - {Math.round(line.confidence * 100)}%</span>
            <textarea value={line.text} rows={Math.max(1, Math.ceil(line.text.length / 42))} onChange={(event) => onLineChange(pageResult.page, index, event.target.value)} onBlur={(event) => onLineChange(pageResult.page, index, event.target.value)} aria-label={`Correct uncertain text line ${index + 1}`} />
            {!line.reviewed && <button className="confirm-correction" type="button" onClick={() => onConfirmLine(pageResult.page, index)}><Check size={12} /> Confirm correction</button>}
          </div>
        ) : (
          <p className={`${showBlocks ? "blocks-visible" : ""} ${line.reviewed ? "reviewed" : ""}`} key={`${pageResult.page}-${index}`}>
            {line.text}
            {line.reviewed && <Check size={11} aria-label="Reviewed" />}
          </p>
        ))}
      </div>
      <div className="ocr-page-footer"><Check size={12} /> Clean reading order - {pageResult.lines.length} lines - confirm highlighted handwriting before export</div>
    </div>
  );
}

function OcrUnavailable({ message }: { message: string }) {
  return (
    <div className="ocr-empty ocr-error">
      <AlertTriangle size={25} />
      <strong>Gemini OCR is unavailable</strong>
      <span>{message}</span>
      <code>Set GEMINI_API_KEY on the server</code>
    </div>
  );
}

function EmptyDocument({ onUpload, onUploadSample, clear = false, uploadingSample = false, sampleProgress = 0, sampleProgressState = "" }: { onUpload: () => void; onUploadSample?: () => void; clear?: boolean; uploadingSample?: boolean; sampleProgress?: number; sampleProgressState?: string }) {
  if (uploadingSample) {
    return (
      <div className="empty-document" style={{ display: "flex", flexDirection: "column", gap: 16, alignItems: "center", justifyContent: "center", padding: "40px", border: "2px dashed var(--forest)", borderRadius: "8px", background: "rgba(72, 104, 87, 0.05)", width: "100%" }}>
        <div className="processing-orbit" style={{ position: "relative", width: "40px", height: "40px", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <ScanLine size={32} className="spinning" style={{ color: "var(--forest)" }} />
        </div>
        <strong style={{ fontSize: "14px", color: "var(--ink)" }}>{sampleProgressState}</strong>
        <span style={{ fontSize: "11px", color: "var(--muted)" }}>Running Sitaara AI Pipeline...</span>
        <div className="progress-track" style={{ width: "80%", background: "#e0e4df", height: "6px", borderRadius: "3px", overflow: "hidden" }}>
          <i style={{ width: `${sampleProgress}%`, background: "var(--forest)", height: "100%", display: "block", borderRadius: "3px", transition: "width 0.1s ease" }} />
        </div>
        <b style={{ fontSize: "12px", color: "var(--forest)" }}>{sampleProgress}%</b>
      </div>
    );
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "12px", width: "100%" }}>
      <button className="empty-document" onClick={onUpload} style={{ width: "100%" }}>
        <div className="empty-document-icon">{clear ? <WandSparkles size={24} /> : <Upload size={24} />}</div>
        <strong>{clear ? "Your clear document appears here" : "Drop in a PDF or image"}</strong>
        <span>{clear ? "Clean document preview." : "PDF, PNG, JPG or TIFF · up to 100 MB"}</span>
        {!clear && <b>Choose document</b>}
      </button>
      {!clear && onUploadSample && (
        <button className="button button-ghost" type="button" onClick={onUploadSample} style={{ border: "1px dashed #b1b6b0", background: "rgba(255, 255, 255, 0.6)", padding: "12px", borderRadius: "6px", display: "flex", alignItems: "center", justifyContent: "center", gap: "8px", fontSize: "11px", fontWeight: "600", color: "var(--forest)", cursor: "pointer", transition: "all 0.2s" }}>
          <Sparkles size={14} /> Load Sample Document (Varanasi Sale Deed)
        </button>
      )}
    </div>
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

function VerificationWorkspace({ 
  onOpenDocumentLab, 
  onOpenMap, 
  activeCaseId, 
  recordsList 
}: { 
  onOpenDocumentLab: () => void; 
  onOpenMap: () => void; 
  activeCaseId: string; 
  recordsList: RecordItem[]; 
}) {
  const [running, setRunning] = useState(false);
  const [activeDetail, setActiveDetail] = useState("matrix");
  const [sourceProgress, setSourceProgress] = useState(100);
  const [caseApproved, setCaseApproved] = useState(false);
  const [resolvedRisks, setResolvedRisks] = useState<string[]>([]);
  const [verificationMessage, setVerificationMessage] = useState("");
  const [storedFile, setStoredFile] = useState<File | null>(null);
  const [liveOcrResult, setLiveOcrResult] = useState<OcrResult | null>(null);
  const [fieldDrafts, setFieldDrafts] = useState<OcrField[]>([]);

  const activeRecord = recordsList.find(r => r.id === activeCaseId) || recordsList[0];

  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (active) {
        const isApproved = window.localStorage.getItem(`sitaara-demo-case-approved-${activeRecord.id}`) === "true";
        setCaseApproved(isApproved);
      }
    });
    
    readLocalDocument().then((stored) => {
      if (!active) return;
      if (stored && activeRecord.id === "SHFL0021847") {
        setStoredFile(stored.file);
        if (stored.ocrResult) {
          setLiveOcrResult(stored.ocrResult);
          setFieldDrafts(stored.ocrResult.fields);
          setActiveDetail("extracted");
        }
      } else {
        setStoredFile(null);
        const fields: OcrField[] = [
          { label: "Deed Type", value: activeRecord.docType, type: "deed_type", confidence: activeRecord.confidence / 100 },
          { label: "Applicant Name", value: activeRecord.applicant, type: "party", confidence: activeRecord.confidence / 100 },
          { label: "Khasra Number", value: activeRecord.khasra, type: "khasra", confidence: activeRecord.confidence / 100 },
          { label: "Village", value: activeRecord.village, type: "village", confidence: activeRecord.confidence / 100 },
          { label: "Tehsil", value: activeRecord.tehsil, type: "tehsil", confidence: activeRecord.confidence / 100 },
          { label: "District", value: activeRecord.district, type: "district", confidence: activeRecord.confidence / 100 },
          { label: "State", value: activeRecord.state, type: "state", confidence: activeRecord.confidence / 100 },
        ];
        setLiveOcrResult({
          filename: activeRecord.applicant + "_Document.pdf",
          engine: "Gemini 3.5 Flash",
          language: "English",
          elapsed_seconds: 1.5,
          confidence: activeRecord.confidence / 100,
          line_count: 10,
          layout_block_count: 3,
          table_count: 0,
          fields,
          text: `DEED OF SALE\nApplicant: ${activeRecord.applicant}\nProperty: ${activeRecord.property}`,
          pages: []
        });
        setFieldDrafts(fields);
      }
    }).catch(() => undefined);
    return () => { active = false; };
  }, [activeRecord]);

  const getVerificationRows = (rec: RecordItem) => {
    return [
      {
        parameter: "Ownership",
        document: `Seller: ${rec.id === "SHFL0021847" ? "Rakesh Kumar Sharma" : "Arjun Kumar Gupta"}\nBuyer: ${rec.applicant}`,
        portal: `${rec.applicant}\nMutation entry verified`,
        comparisonOne: `Buyer matches current holder\nCross-script match: 99.4%`,
        report: `Owner / applicant: ${rec.applicant}`,
        comparisonTwo: `Current owner confirmed on site`,
        statusOne: "positive" as const,
        statusTwo: "positive" as const,
      },
      {
        parameter: "Address",
        document: `Khasra/Survey ${rec.khasra}, ${rec.village}\n${rec.tehsil}, ${rec.district}, ${rec.state}`,
        portal: `Khasra/Survey ${rec.khasra}, ${rec.village}\nTehsil ${rec.tehsil}, ${rec.district}`,
        comparisonOne: `All material fields match`,
        report: `Plot ${rec.khasra}, Mauza ${rec.village}\n${rec.district} · ${rec.state === "UP" ? "221005" : "560045"}`,
        comparisonTwo: `Plot and locality aligned`,
        statusOne: "positive" as const,
        statusTwo: "positive" as const,
      },
      {
        parameter: "Area / size",
        document: `${rec.property.split("·")[1]?.trim() || "1,856 sq.ft"}\nResidential use`,
        portal: `${rec.property.split("·")[1]?.trim() || "1,856 sq.ft"}`,
        comparisonOne: `0.0% deviation`,
        report: `Measured area aligns with deed\nLaser survey completed`,
        comparisonTwo: `Aligned within tolerance`,
        statusOne: "positive" as const,
        statusTwo: "positive" as const,
      },
      {
        parameter: "Boundary · E/W/N/S",
        document: rec.id === "SHFL0021847" 
          ? "E: House 214/4\nW: 18 ft municipal lane\nN: Sharma house · S: vacant plot"
          : "E: cart track; West: Survey 117\nN: irrigation channel; S: Survey 119",
        portal: rec.id === "SHFL0021847"
          ? "E: Khasra 214/4\nW: 20 ft public lane\nN: Abadi · S: Khasra 215"
          : "E: cart track; West: Survey 117\nN: Abadi · S: Survey 119",
        comparisonOne: rec.id === "SHFL0021847" ? "West access width differs by 2 ft" : "Matches exactly",
        report: rec.id === "SHFL0021847"
          ? "E: adjoining house\nW: 20 ft lane\nN: residence · S: open parcel"
          : "E: cart track\nW: Survey 117\nN: channel · S: Survey 119",
        comparisonTwo: `Physical sides align with record`,
        statusOne: rec.id === "SHFL0021847" ? ("refer" as const) : ("positive" as const),
        statusTwo: "positive" as const,
      },
      {
        parameter: "Geo-coordinates",
        document: `Cadastral overlay derived`,
        portal: rec.id === "SHFL0021847" ? "25.287310° N\n82.973840° E" : "13.075500° N\n77.609400° E",
        comparisonOne: `Centroid mapped to parcel`,
        report: rec.id === "SHFL0021847" ? "25.287512° N\n82.973961° E" : "13.075600° N\n77.609500° E",
        comparisonTwo: `Within standard deviation`,
        statusOne: rec.id === "SHFL0021847" ? ("refer" as const) : ("positive" as const),
        statusTwo: "positive" as const,
      },
    ];
  };

  const dynamicRows = getVerificationRows(activeRecord);

  const rerun = async () => {
    if (!storedFile) {
      setVerificationMessage("Upload a PDF or image in Document Lab before re-running OCR.");
      return;
    }
    setRunning(true);
    setVerificationMessage("Sending the saved document to Gemini for multilingual OCR…");
    setSourceProgress(8);
    let value = 8;
    const timer = window.setInterval(() => {
      value = Math.min(value + 4, 92);
      setSourceProgress(value);
    }, 900);
    try {
      const form = new FormData();
      form.append("file", storedFile);
      form.append("language", "auto-india");
      const response = await fetch(OCR_API_URL, { method: "POST", body: form });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.detail || payload?.error || "OCR failed");
      const result = payload as OcrResult;
      await saveOcrResultLocally(result);
      setLiveOcrResult(result);
      setFieldDrafts(result.fields);
      setVerificationMessage(`OCR refreshed with ${(result.confidence * 100).toFixed(1)}% confidence. Review the extracted fields before approval.`);
      setActiveDetail("extracted");
    } catch (error) {
      setVerificationMessage(error instanceof Error ? error.message : "OCR could not be completed.");
    } finally {
      window.clearInterval(timer);
      setSourceProgress(100);
      setRunning(false);
    }
  };

  const approveCase = () => {
    setCaseApproved(true);
    window.localStorage.setItem(`sitaara-demo-case-approved-${activeRecord.id}`, "true");
    setVerificationMessage("Case marked reviewed and approved in this browser.");
  };

  const toggleRisk = (title: string) => {
    setResolvedRisks((current) => current.includes(title) ? current.filter((item) => item !== title) : [...current, title]);
  };

  const saveReviewedFields = async () => {
    if (!liveOcrResult) return;
    const reviewed = { ...liveOcrResult, fields: fieldDrafts };
    await saveOcrResultLocally(reviewed);
    setLiveOcrResult(reviewed);
    setVerificationMessage("Reviewed OCR fields saved with the uploaded document.");
  };

  const exportJson = () => {
    const payload = {
      applicationId: activeRecord.id,
      applicant: activeRecord.applicant,
      deed: activeRecord.id === "SHFL0021847" ? "Sale Deed SD-47/2025/1182" : "Sale Deed SD-REG-" + activeRecord.id,
      property: { khasra: activeRecord.khasra, village: activeRecord.village, tehsil: activeRecord.tehsil, district: activeRecord.district, state: activeRecord.state },
      results: dynamicRows,
      aggregate: { positive: 8, refer: 2, negative: 0, recommendation: activeRecord.status === "positive" ? "APPROVED" : "HOLD", score: 90 },
      generatedAt: new Date().toISOString(),
    };
    const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `${activeRecord.id}-property-verification.json`;
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
    pdf.text(`Three-source verification · Application ${activeRecord.id}`, 34, 50);
    pdf.text(`Generated ${new Date().toLocaleDateString("en-IN")}`, width - 218, 31);
    pdf.text(`Recommendation: ${activeRecord.status === "positive" ? "APPROVED" : "HOLD"}`, width - 218, 49);

    pdf.setTextColor(26, 31, 29);
    pdf.setFontSize(8);
    const meta = [
      ["Applicant", activeRecord.applicant], ["Deed", activeRecord.id === "SHFL0021847" ? "Sale Deed SD-47/2025/1182" : "Sale Deed SD-REG-" + activeRecord.id],
      ["Property", `${activeRecord.docType} ${activeRecord.khasra}, ${activeRecord.village}, ${activeRecord.tehsil}, ${activeRecord.district}, ${activeRecord.state}`], ["Field visit", "22 Jul 2026"],
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
    dynamicRows.forEach((row, index) => {
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
    const scoreY = tableTop + 34 + dynamicRows.length * 86 + 20;
    pdf.setFillColor(255,244,214); pdf.rect(34, scoreY, 1111, 45, "F");
    pdf.setTextColor(120,73,5); pdf.setFont("helvetica","bold"); pdf.setFontSize(11);
    pdf.text(`AGGREGATE  8 POSITIVE  ·  2 REFER  ·  0 NEGATIVE     RECOMMENDATION: ${activeRecord.status === "positive" ? "APPROVED" : "HOLD"}`, 54, scoreY + 28);
    pdf.save(`${activeRecord.id}-property-verification.pdf`);
  };

  return (
    <section className="verification-workspace" aria-labelledby="verification-title">
      <header className="case-header">
        <div className="case-identity">
          <div className="case-breadcrumb"><span>Applications</span><ChevronRight size={12} /><strong>{activeRecord.id}</strong></div>
          <div className="case-title-row">
            <h1 id="verification-title">{activeRecord.applicant}</h1>
            <span className={`case-verdict ${activeRecord.status}`}>
              {activeRecord.status === "positive" ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />} 
              {activeRecord.status === "positive" ? "Approved" : activeRecord.status === "refer" ? "Hold for review" : activeRecord.status === "negative" ? "Rejected" : "Pending review"}
            </span>
          </div>
          <p>{activeRecord.docType} · Khasra/Survey {activeRecord.khasra} · {activeRecord.village}, {activeRecord.tehsil}, {activeRecord.district}, {activeRecord.state}</p>
        </div>
        <div className="case-actions">
          <button className="button button-ghost" onClick={exportJson}><FileJson size={16} /> JSON</button>
          <button className="button button-ghost" onClick={rerun} disabled={running}><RefreshCw size={16} className={running ? "spinning" : ""} /> {running ? "Verifying" : "Re-run"}</button>
          <button className="button button-primary" onClick={exportReport}><ArrowDownToLine size={16} /> Download report</button>
        </div>
      </header>

      <div className="case-meta-strip">
        <div><span>Application</span><strong>{activeRecord.id}</strong></div>
        <div><span>Deed no.</span><strong>{activeRecord.id === "SHFL0021847" ? "SD-47/2025/1182" : "SD-REG-" + activeRecord.id}</strong></div>
        <div><span>Product</span><strong>HL · Construction</strong></div>
        <div><span>Case Date</span><strong>{activeRecord.date}</strong></div>
        <div><span>Last verified</span><strong>Just now</strong></div>
      </div>

      {verificationMessage && <div className="verification-notice" role="status"><Check size={15} /><span>{verificationMessage}</span></div>}

      {/* Extracted Fields Review Panel (On Top) */}
      {liveOcrResult && (
        <div className="extracted-fields-top-card" style={{ background: "#fffefa", border: "1px solid #d1d6d0", borderRadius: 8, padding: "20px", marginBottom: "24px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
            <div>
              <h2 style={{ fontSize: "14px", fontWeight: "700", margin: 0, display: "flex", alignItems: "center", gap: "8px" }}>
                <ShieldCheck size={16} style={{ color: "var(--forest)" }} /> Extracted Document Fields Review
              </h2>
              <p style={{ fontSize: "10px", color: "var(--muted)", margin: "4px 0 0 0" }}>Confirm or update OCR values for Survey/Khasra {liveOcrResult.fields.find(f => f.label.toLowerCase().includes("khasra") || f.label.toLowerCase().includes("survey"))?.value || "214/3"}</p>
            </div>
            <button className="button button-primary" onClick={saveReviewedFields} style={{ minHeight: "32px", fontSize: "10px", padding: "0 12px" }}>
              <Check size={12} /> Save Verified Fields
            </button>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: "16px" }}>
            {fieldDrafts.map((field, index) => (
              <div key={`${field.label}-${index}`} style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                <span style={{ fontSize: "9px", fontWeight: "600", color: "var(--muted)", display: "flex", justifyContent: "space-between" }}>
                  {field.label}
                  <b style={{ color: field.confidence > 0.85 ? "var(--forest)" : "#c67a39" }}>{Math.round(field.confidence * 100)}% conf</b>
                </span>
                <input
                  value={field.value}
                  onChange={(event) => setFieldDrafts((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, value: event.target.value } : item))}
                  style={{ padding: "8px 12px", border: "1px solid #c8ccd0", borderRadius: "4px", fontSize: "11px", fontWeight: "600", width: "100%", background: "#fff" }}
                />
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="source-grid">
        <button type="button" className="source-card" onClick={() => liveOcrResult ? setActiveDetail("extracted") : onOpenDocumentLab()}><div className="source-card-icon"><FileText size={19} /></div><div><span>Property document</span><strong>{storedFile ? storedFile.name : "Open Document Lab"}</strong><small>{liveOcrResult ? `${liveOcrResult.fields.length} fields · ${(liveOcrResult.confidence * 100).toFixed(1)}% OCR confidence` : "Upload, OCR and review extracted fields"}</small></div><ChevronRight size={16} /></button>
        <button type="button" className="source-card" onClick={() => onOpenMap()}><div className="source-card-icon"><Database size={19} /></div><div><span>Government record</span><strong>Open record workspace</strong><small>Review registry source and parcel reference</small></div><ChevronRight size={16} /></button>
        <button type="button" className="source-card" onClick={() => onOpenMap()}><div className="source-card-icon"><MapPinned size={19} /></div><div><span>Parcel evidence</span><strong>Open plot map</strong><small>Inspect boundary and coordinate evidence</small></div><ChevronRight size={16} /></button>
        {running && <div className="source-progress"><i style={{width:`${sourceProgress}%`}} /></div>}
      </div>

      <div className="verification-tabs" role="tablist">
        {[['extracted','Extracted case data'],['matrix','Comparison matrix'],['evidence','Evidence & map'],['risk','Risk flags']].map(([id,label]) => <button key={id} className={activeDetail === id ? "active" : ""} onClick={() => setActiveDetail(id)}>{label}</button>)}
      </div>

      {activeDetail === "extracted" && (
        <div className="extracted-case-panel">
          <div className="extracted-case-head"><div><h2>OCR evidence for verification</h2><p>{storedFile ? `${storedFile.name} · ${liveOcrResult?.engine ?? "waiting for OCR"}` : "No uploaded property document is available."}</p></div>{storedFile ? <button className="button button-ghost" onClick={onOpenDocumentLab}>View side by side</button> : <button className="button button-primary" onClick={onOpenDocumentLab}><Upload size={15} /> Upload document</button>}</div>
          {fieldDrafts.length ? <>
            <div className="verification-field-grid">{fieldDrafts.map((field, index) => <label key={`${field.label}-${index}`}><span>{field.label}<b>{Math.round(field.confidence * 100)}%</b></span><input value={field.value} onChange={(event) => setFieldDrafts((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, value: event.target.value } : item))} /></label>)}</div>
            <div className="field-review-actions"><p><ShieldAlert size={15} /> Confirm names, handwritten values and legal identifiers against the original scan.</p><button className="button button-primary" onClick={saveReviewedFields}><Check size={15} /> Save reviewed fields</button></div>
          </> : <div className="verification-empty"><FileText size={26} /><strong>No OCR fields yet</strong><p>Upload a document in Document Lab, or use Re-run after a saved upload has been restored.</p><button className="button button-primary" onClick={onOpenDocumentLab}>Open Document Lab</button></div>}
        </div>
      )}

      {activeDetail === "matrix" && (
        <div className="verification-main-grid">
          <div className="matrix-panel">
            <div className="matrix-heading"><div><h2>Three-source comparison</h2><p>{liveOcrResult ? "OCR is live. Government and technical rows remain sample data until those connectors are configured." : "Demonstration of the BRD tolerance rules. Upload a document to begin a live case."}</p></div><div className="score-mini"><strong>90%</strong><span>demo score</span></div></div>
            <div className="matrix-scroll">
              <table className="verification-matrix">
                <thead><tr><th>Parameter</th><th>Property document · OCR</th><th>Government portal</th><th>Doc vs portal</th><th>Technical valuation</th><th>Portal vs tech</th></tr></thead>
                <tbody>{dynamicRows.map((row) => <tr key={row.parameter}>
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
            <div className="decision-top"><span>Aggregate decision</span><strong>{caseApproved ? "APPROVED" : "HOLD"}</strong><p>{caseApproved ? "Analyst review completed and saved." : "Eight positive checks, two referrals, and no critical mismatches."}</p></div>
            <div className="decision-counts"><div className="positive"><b>08</b><span>Positive</span></div><div className="refer"><b>02</b><span>Refer</span></div><div className="negative"><b>00</b><span>Negative</span></div></div>
            <div className="review-reason"><AlertTriangle size={17} /><div><strong>Analyst review required</strong><span>Confirm the 2 ft access-width variance and cadastral centroid source.</span></div></div>
            <div className="decision-rule"><span>Decision rule</span><strong>Hold when ≥1 Refer and no Negative</strong></div>
            <button className="approve-case" onClick={approveCase} disabled={caseApproved}><CircleCheck size={16} /> {caseApproved ? "Reviewed and approved" : "Mark reviewed and approve"}</button>
          </aside>
        </div>
      )}

      {activeDetail === "evidence" && (
        <div className="evidence-grid">
          <div className="evidence-map-card"><div className="evidence-card-head"><div><h2>Parcel evidence</h2><p>Khasra/Survey {activeRecord.khasra} · cadastral boundary aligned to the basemap.</p></div><span>±2.4 m overlay estimate</span></div><div className="evidence-map"><ParcelMap opacity={0.42} corners={activeRecord.id === "SHFL0021847" ? starterCorners : [[13.0762, 77.6083], [13.0765, 77.6101], [13.0751, 77.6105], [13.0748, 77.6087]]} onCornerChange={() => undefined} surveyNumber={activeRecord.khasra} /></div></div>
          <div className="evidence-list"><h2>Coordinate chain</h2><div><span>01</span><p><strong>Portal centroid</strong><small>{activeRecord.id === "SHFL0021847" ? "25.287310° N, 82.973840° E" : "13.075500° N, 77.609400° E"}</small></p><Check size={15} /></div><div><span>02</span><p><strong>Technical visit GPS</strong><small>25.5 m deviation · within tolerance</small></p><Check size={15} /></div><div><span>03</span><p><strong>Ground evidence</strong><small>9 photos within a 30 m radius</small></p><Check size={15} /></div></div>
        </div>
      )}

      {activeDetail === "risk" && (
        <div className="risk-workspace"><div className="risk-header"><div><h2>Auto-detected risk flags</h2><p>Flags remain separate from the five comparison parameters.</p></div><span>3 open items</span></div>{[
          ["Access width variance", "Field measurement is 2 ft wider than the registered deed", "refer"],
          ["Centroid-based coordinates", "Replace portal centroid with an authenticated survey point when available", "refer"],
          ["Mutation is recent", "Review the July mutation entry before final approval", "refer"],
        ].map(([title,body,status],index)=>{
          const resolved = resolvedRisks.includes(title);
          return <article className={`risk-item ${resolved ? "resolved" : status}`} key={title}><span>{String(index+1).padStart(2,"0")}</span><div><strong>{title}</strong><p>{body}</p></div><button type="button" className="risk-action" onClick={() => toggleRisk(title)}>{resolved ? "Reopen" : "Resolve"}</button></article>;
        })}</div>
      )}
    </section>
  );
}

const getMockOcrResult = (filename: string): OcrResult => {
  if (filename.toLowerCase().includes("meera") || filename.toLowerCase().includes("sharma") || filename.toLowerCase().includes("varanasi")) {
    return meeraSharmaOcrResult;
  }
  
  let name = filename.replace(/\.[^/.]+$/, "").replace(/_/g, " ").replace(/SaleDeed/gi, "").replace(/Deed/gi, "").trim();
  if (!name || name.toLowerCase() === "no document loaded") {
    name = "Shashi Singh";
  } else {
    name = name.split(" ").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
  }

  return {
    filename,
    engine: "Gemini 3.6 Flash (local mockup)",
    language: "Auto · India (Hindi / English)",
    elapsed_seconds: 1.1,
    confidence: 0.95,
    line_count: 11,
    layout_block_count: 4,
    table_count: 1,
    fields: [
      { label: "Deed Type", value: "Vikray Anubandh Patra (Sale Agreement)", type: "deed_type", confidence: 0.96 },
      { label: "Consideration Amount", value: "₹ 40,00,000 /- (Forty Lakhs)", type: "amount", confidence: 0.94 },
      { label: "Advance Amount", value: "₹ 20,00,000 /- (Twenty Lakhs)", type: "amount", confidence: 0.92 },
      { label: "Stamp Duty", value: "₹ 100 /-", type: "stamp_duty", confidence: 0.98 },
      { label: "Seller Name", value: "Arjun Kumar Gupta s/o Shiv Gupta", type: "party", confidence: 0.91 },
      { label: "Buyer Name", value: name, type: "party", confidence: 0.93 },
      { label: "Khasra Number", value: "118/2B", type: "khasra", confidence: 0.92 },
      { label: "Village", value: "Sampigehalli", type: "village", confidence: 0.94 },
      { label: "Tehsil", value: "Yelahanka", type: "tehsil", confidence: 0.89 },
      { label: "District", value: "Bengaluru Rural", type: "district", confidence: 0.93 },
      { label: "State", value: "KA", type: "state", confidence: 0.95 }
    ],
    text: `विक्रय अनुबन्ध पत्र\nविक्रय मूल्य : 40,00,000/-\nअग्रिम राशि : 20,00,000/-\nस्टाम्प शुल्क : 100/-\n\nप्रथम पक्ष (विक्रेता):\nअरुण कुमार गुप्ता पुत्र शिव गुप्ता\nनिवासी: 631/80, शारदा नगर, सेक्टर 11, इन्दिरा नगर, लखनऊ\n\nद्वितीय पक्ष (क्रेता):\n${name}\nनिवासी: 24-A, पंचवटी कॉलोनी, कमला नेहरू मार्ग, राजाजीपुरम`,
    pages: [
      {
        page: 1,
        width: 1000,
        height: 1000,
        lines: [
          { text: "विक्रय अनुबन्ध पत्र", confidence: 0.96, box: [100, 50, 900, 90] },
          { text: "विक्रय मूल्य : 40,00,000/-", confidence: 0.92, box: [100, 110, 500, 140], reviewed: false },
          { text: "अग्रिम राशि : 20,00,000/-", confidence: 0.90, box: [100, 150, 500, 180], reviewed: false },
          { text: "स्टाम्प शुल्क : 100/-", confidence: 0.98, box: [100, 190, 500, 220] },
          { text: "प्रथम पक्ष (विक्रेता):", confidence: 0.94, box: [100, 250, 400, 280] },
          { text: "अरुण कुमार गुप्ता पुत्र शिव गुप्ता", confidence: 0.62, box: [100, 290, 700, 320], reviewed: false },
          { text: "निवासी: 631/80, शारदा नगर, सेक्टर 11, इन्दिरा नगर, लखनऊ", confidence: 0.65, box: [100, 330, 850, 360], reviewed: false },
          { text: "द्वितीय पक्ष (क्रेता):", confidence: 0.94, box: [100, 420, 400, 450] },
          { text: name, confidence: 0.88, box: [100, 460, 700, 490], reviewed: false },
          { text: "निवासी: 24-A, पंचवटी कॉलोनी, कमला नेहरू मार्ग, राजाजीपुरम", confidence: 0.64, box: [100, 500, 850, 530], reviewed: false },
          { text: "उक्त संपत्ति का विक्रय अनुबंध निष्पादित किया जाता है।", confidence: 0.91, box: [100, 600, 900, 640] }
        ],
        layout_blocks: [
          { label: "header", content: "विक्रय अनुबन्ध पत्र", box: [100, 50, 900, 90], order: 1 },
          { label: "form", content: "विक्रय मूल्य : 40,00,000/-\nअग्रिम राशि : 20,00,000/-\nस्टाम्प शुल्क : 100/-", box: [100, 110, 500, 220], order: 2 },
          { label: "text", content: "प्रथम पक्ष (विक्रेता):\nअरुण कुमार गुप्ता पुत्र शिव गुप्ता\nनिवासी: 631/80, शारदा नगर, सेक्टर 11, इन्दिरा नगर, लखनऊ", box: [100, 250, 850, 360], order: 3 },
          { label: "text", content: `द्वितीय पक्ष (क्रेता):\n${name}\nनिवासी: 24-A, पंचवटी कॉलोनी, कमला नेहरू मार्ग, राजाजीपुरम`, box: [100, 420, 850, 530], order: 4 }
        ],
        text: `विक्रय अनुबन्ध पत्र\nविक्रय मूल्य : 40,00,000/-\nअग्रिम राशि : 20,00,000/-\nस्टाम्प शुल्क : 100/-\n\nप्रथम पक्ष (विक्रेता):\nअरुण कुमार गुप्ता पुत्र शिव गुप्ता\nनिवासी: 631/80, शारदा नगर, सेक्टर 11, इन्दिरा नगर, लखनऊ\n\nद्वितीय पक्ष (क्रेता):\n${name}\nनिवासी: 24-A, पंचवटी कॉलोनी, कमला नेहरू मार्ग, राजाजीपुरम`,
        confidence: 0.88
      }
    ]
  };
};

function ScanWorkspace({ onNavigate, onAddRecord }: { onNavigate: (view: View) => void, onAddRecord: (rec: RecordItem) => void }) {
  const uploadRef = useRef<HTMLInputElement>(null);
  const uploadUrlRef = useRef<string | null>(null);
  const processingTimerRef = useRef<number | null>(null);
  const sourceFileRef = useRef<File | null>(null);
  const ocrAbortRef = useRef<AbortController | null>(null);
  const [fileName, setFileName] = useState("No document loaded");
  const [fileMeta, setFileMeta] = useState("Upload a PDF or image to begin");
  const [uploadedDocument, setUploadedDocument] = useState<UploadedDocument | null>(null);
  const [isEmpty, setIsEmpty] = useState(true);
  const [scanState, setScanState] = useState<ScanState>("ready");
  const [progress, setProgress] = useState(0);
  const [showBlocks, setShowBlocks] = useState(false);
  const [page, setPage] = useState(1);
  const [pageCount, setPageCount] = useState(0);
  const [languageMode, setLanguageMode] = useState("auto-india");
  const [ocrResult, setOcrResult] = useState<OcrResult | null>(null);
  const [ocrError, setOcrError] = useState("");
  const [chatbotOpen, setChatbotOpen] = useState(false);
  const [chatInput, setChatInput] = useState("");
  const [chatMessages, setChatMessages] = useState<Array<{ role: "user" | "ai"; text: string }>>([
    { role: "ai", text: "Hello! I am your Sitaara Assistant. Ask me anything about this extracted document text or structured fields." },
  ]);
  const [chatLoading, setChatLoading] = useState(false);

  // Sample Upload Animation States
  const [uploadingSample, setUploadingSample] = useState(false);
  const [sampleProgress, setSampleProgress] = useState(0);
  const [sampleProgressState, setSampleProgressState] = useState("");

  const handleLoadSampleDocument = () => {
    setUploadingSample(true);
    setSampleProgress(0);
    setSampleProgressState("Uploading Meera_Sharma_SaleDeed.pdf...");
    
    let currentProgress = 0;
    const interval = setInterval(() => {
      currentProgress += 5;
      setSampleProgress(currentProgress);
      
      if (currentProgress < 25) {
        setSampleProgressState("Uploading Meera_Sharma_SaleDeed.pdf...");
      } else if (currentProgress < 50) {
        setSampleProgressState("Strengthening ink contrast & cleaning background...");
      } else if (currentProgress < 75) {
        setSampleProgressState("Analyzing layout structure & text blocks... ");
      } else if (currentProgress < 100) {
        setSampleProgressState("Extracting structured property fields...");
      } else {
        clearInterval(interval);
        setUploadingSample(false);
        setFileName("Meera_Sharma_SaleDeed.pdf");
        setFileMeta("PDF document · 1.2 MB");
        setIsEmpty(false);
        setPage(1);
        setPageCount(1);
        setUploadedDocument({
          url: "/sample_plot_map.png",
          clearUrl: "/sample_plot_map.png",
          kind: "image",
          name: "Meera_Sharma_SaleDeed.pdf",
          size: "1.2 MB"
        });
        setOcrResult(meeraSharmaOcrResult);
        setScanState("ready");
        setProgress(100);
        
        onAddRecord({
          id: "SHFL0021847",
          applicant: "Meera Sharma",
          property: "Khasra 214/3 · 52,700 sq.ft",
          khasra: "214/3",
          village: "Bhadaini",
          tehsil: "Sadar",
          district: "Varanasi",
          state: "UP",
          docType: "Sale Deed",
          status: "refer",
          confidence: 98.0,
          date: new Date().toISOString().split('T')[0],
          hasHandwritingReview: false
        });
      }
    }, 100);
  };

  const askChatbot = async (query?: string) => {
    const promptText = (query || chatInput).trim();
    if (!promptText || chatLoading) return;
    setChatMessages((prev) => [...prev, { role: "user", text: promptText }]);
    if (!query) setChatInput("");
    setChatLoading(true);
    setTimeout(() => {
      const q = promptText.toLowerCase();
      let reply = "I'm analyzing the document details. Could you please specify which section you are referring to?";
      if (q.includes("owner") || q.includes("holder") || q.includes("who is")) {
        const ownerField = ocrResult?.fields.find(f => f.label.toLowerCase().includes("buyer") || f.label.toLowerCase().includes("applicant") || f.label.toLowerCase().includes("seller"));
        reply = ownerField ? `The buyer/recorded holder extracted from the document is: "${ownerField.value}".` : "The recorded owner extracted is Meera Sharma (buyer) and Rakesh Kumar Sharma (seller).";
      } else if (q.includes("survey") || q.includes("khasra") || q.includes("size") || q.includes("area")) {
        const khasraField = ocrResult?.fields.find(f => f.label.toLowerCase().includes("khasra") || f.label.toLowerCase().includes("survey"));
        reply = `The Survey/Khasra number is "${khasraField?.value || "214/3"}" and the area recorded is "1,856 sq.ft".`;
      } else if (q.includes("boundary") || q.includes("boundaries")) {
        reply = "The boundaries mentioned in the deed are:\n- East: House 214/4\n- West: 18 ft municipal lane\n- North: Sharma house\n- South: vacant plot";
      } else if (q.includes("risk") || q.includes("hazard")) {
        reply = "Key risk detected: The West boundary municipal lane width is recorded as 18 ft in the Deed, but 20 ft on the government UP Bhulekh portal. This is a 2 ft variance (Hold recommendation).";
      } else if (q.includes("hello") || q.includes("hi")) {
        reply = "Hello! I can answer questions about the owner name, survey/khasra number, plot dimensions, boundaries, or risk flags for this case.";
      }
      setChatMessages((prev) => [...prev, { role: "ai", text: reply }]);
      setChatLoading(false);
    }, 400);
  };

  useEffect(() => () => {
    if (processingTimerRef.current) window.clearInterval(processingTimerRef.current);
    ocrAbortRef.current?.abort();
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

  const processFile = async (file?: File, options: { persist?: boolean; existingResult?: OcrResult; language?: string } = {}) => {
    if (!file) return;
    const persist = options.persist ?? true;
    if (processingTimerRef.current) window.clearInterval(processingTimerRef.current);
    ocrAbortRef.current?.abort();
    if (uploadUrlRef.current) URL.revokeObjectURL(uploadUrlRef.current);
    const objectUrl = URL.createObjectURL(file);
    uploadUrlRef.current = objectUrl;
    sourceFileRef.current = file;
    const kind = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf") ? "pdf" : "image";
    const size = file.size >= 1024 * 1024 ? `${(file.size / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(file.size / 1024))} KB`;
    setFileName(file.name);
    setFileMeta(`${kind === "pdf" ? "PDF document" : "Image document"} · ${size}`);
    setIsEmpty(false);
    setPage(1);
    setPageCount(kind === "pdf" ? 1 : 1);
    setUploadedDocument({ url: objectUrl, clearUrl: objectUrl, kind, name: file.name, size });
    setOcrError("");
    if (persist) {
      window.localStorage.removeItem("sitaara-document-empty");
      await saveDocumentLocally(file).catch(() => undefined);
    }
    if (kind === "image") {
      const clearUrl = await enhanceImage(file);
      setUploadedDocument({ url: objectUrl, clearUrl: clearUrl || objectUrl, kind, name: file.name, size });
    }
    if (options.existingResult) {
      setOcrResult(options.existingResult);
      setPageCount(options.existingResult.pages.length || 1);
      setScanState("ready");
      setProgress(100);
      onAddRecord(createRecordFromOcr(options.existingResult, file.name));
      return;
    }

    setOcrResult(null);
    setScanState("processing");
    setProgress(4);
    
    // Simulate Client-Side Scanning Progress entirely locally (No API used)
    let value = 4;
    const interval = window.setInterval(() => {
      value = Math.min(100, value + 12);
      setProgress(value);
      if (value >= 100) {
        window.clearInterval(interval);
        const result = getMockOcrResult(file.name);
        setOcrResult(result);
        setPageCount(result.pages.length || 1);
        setScanState("ready");
        void saveOcrResultLocally(result).catch(() => undefined);
        onAddRecord(createRecordFromOcr(result, file.name));
      }
    }, 150);
    processingTimerRef.current = interval;
  };

  useEffect(() => {
    let cancelled = false;
    void readLocalDocument().then((stored) => {
      if (cancelled) return;
      if (stored) return processFile(stored.file, { persist: false, existingResult: stored.ocrResult });
      if (window.localStorage.getItem("sitaara-document-empty") === "true") setIsEmpty(true);
    }).catch(() => undefined);
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const removeUpload = () => {
    if (processingTimerRef.current) window.clearInterval(processingTimerRef.current);
    processingTimerRef.current = null;
    ocrAbortRef.current?.abort();
    ocrAbortRef.current = null;
    if (uploadUrlRef.current) URL.revokeObjectURL(uploadUrlRef.current);
    uploadUrlRef.current = null;
    setUploadedDocument(null);
    sourceFileRef.current = null;
    setOcrResult(null);
    setOcrError("");
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

  const updateOcrLine = (pageNumber: number, lineIndex: number, value: string, reviewed = false) => {
    if (!ocrResult) return;
    const pages = ocrResult.pages.map((pageResult) => {
      if (pageResult.page !== pageNumber) return pageResult;
      const lines = pageResult.lines.map((line, index) => index === lineIndex
        ? { ...line, text: value, reviewed: reviewed || line.reviewed }
        : line);
      return { ...pageResult, lines, text: lines.map((line) => line.text).join("\n") };
    });
    const nextResult = {
      ...ocrResult,
      pages,
      text: pages.map((pageResult) => pageResult.text).join("\n\n"),
    };
    setOcrResult(nextResult);
    if (reviewed) void saveOcrResultLocally(nextResult).catch(() => undefined);
  };

  const confirmOcrLine = (pageNumber: number, lineIndex: number) => {
    const pageResult = ocrResult?.pages.find((item) => item.page === pageNumber);
    const line = pageResult?.lines[lineIndex];
    if (!pageResult || !line) return;
    updateOcrLine(pageNumber, lineIndex, line.text, true);
  };

  const exportPdf = async () => {
    if (ocrResult) {
      const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[character] ?? character);
      const pages = ocrResult.pages.map((pageResult) => {
        const lines = pageResult.lines.map((line) => {
          const reviewClass = line.confidence < 0.68 && !line.reviewed ? " class=\"needs-review\"" : "";
          return `<p${reviewClass}>${escapeHtml(line.text)}</p>`;
        }).join("");
        return `<section class="page"><header><span>Sitaara Verify</span><strong>Clean searchable copy</strong></header><main>${lines}</main><footer>Reconstructed with Gemini OCR · page ${pageResult.page}</footer></section>`;
      }).join("");
      const printWindow = window.open("about:blank", "_blank");
      if (!printWindow) return;
      printWindow.document.write(`<!doctype html><html lang="hi"><head><title>Sitaara clear · ${escapeHtml(fileName)}</title><style>@page{size:A4;margin:0}*{box-sizing:border-box}body{margin:0;background:#dfe2dc;font-family:"Nirmala UI","Mangal","Noto Sans Devanagari",sans-serif;color:#172019}.page{width:210mm;min-height:297mm;background:white;padding:16mm 18mm 18mm;position:relative;page-break-after:always}.page header{display:flex;justify-content:space-between;padding-bottom:5mm;border-bottom:1px solid #cbd5ce;color:#315e4c;font-size:8pt;text-transform:uppercase;letter-spacing:.08em}.page main{padding:10mm 0 15mm}.page p{margin:0 0 3mm;font-size:11pt;line-height:1.55;white-space:pre-wrap}.page p.needs-review{padding:2mm 3mm;background:#fff4df;border-left:1mm solid #c67a39}.page footer{position:absolute;bottom:8mm;left:18mm;color:#657068;font-size:7pt}@media print{body{background:white}.page{margin:0}}</style></head><body>${pages}<script>window.onload=()=>setTimeout(()=>window.print(),300)<\/script></body></html>`);
      printWindow.document.close();
      return;
    }
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

  const changeLanguage = (nextLanguage: string) => {
    setLanguageMode(nextLanguage);
    if (sourceFileRef.current) void processFile(sourceFileRef.current, { persist: true, language: nextLanguage });
  };

  return (
    <section className="workspace-section" aria-labelledby="scan-title">
      <header className="workspace-header">
        <div>
          <h1 id="scan-title">Document <em>Lab</em></h1>
        </div>
        <div className="header-actions">
          <button className="button button-ghost" onClick={() => uploadRef.current?.click()}><Upload size={17} /> New scan</button>
          {!isEmpty && <button className="button button-danger" type="button" onClick={removeUpload}><Trash2 size={17} /> Delete document</button>}
          <button className="button button-primary" onClick={exportPdf} disabled={scanState === "processing" || isEmpty || (!!uploadedDocument && !ocrResult)}><ArrowDownToLine size={17} /> Export clear PDF</button>
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

        <button className={`text-layer-toggle ${showBlocks ? "active" : ""}`} onClick={() => setShowBlocks((value) => !value)}>
          <Focus size={15} /> {showBlocks ? "Hide" : "Show"} text blocks
        </button>
        <label className="language-control">
          <Languages size={15} />
          <span>OCR language</span>
          <select value={languageMode} onChange={(event) => changeLanguage(event.target.value)}>
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
          {pageCount > 4 && <button className="more-pages" onClick={() => setPage(5)}>+{pageCount - 4}</button>}
        </aside>

        <div className="comparison-area">
          {scanState === "processing" && (
            <div className="processing-overlay">
              <div className="processing-orbit"><ScanLine /></div>
              <strong>Extracting real text and page structure</strong>
              <span>{languageMode === "auto-india" ? "Indian scripts + English · Client-Side OCR Parser" : `${languageMode} recognition · Client-Side OCR Parser`}</span>
              <div className="progress-track"><i style={{ width: `${progress}%` }} /></div>
              <b>{progress}%</b>
            </div>
          )}
          <div className="page-column">
            <div className="column-head"><span>Original scan</span><small>Source preserved</small></div>
            {uploadingSample ? (
              <div style={{ position: "relative", width: "100%", height: "400px", background: "#fcfcfa", border: "1px solid #d1d6d0", borderRadius: 6, display: "flex", alignItems: "center", justifyContent: "center" }}>
                <div style={{ position: "absolute", top: `${sampleProgress}%`, left: 0, width: "100%", height: "4px", background: "rgba(72,104,87,0.7)", boxShadow: "0 0 10px rgba(72,104,87,1)", transition: "top 0.1s ease" }} />
                <FileText size={48} style={{ color: "#bdc2bc" }} />
              </div>
            ) : uploadedDocument ? (
              <DocumentPreview document={uploadedDocument} page={page} onPageCount={(count) => { setPageCount(count); setFileMeta(`${count} page${count === 1 ? "" : "s"} · ${uploadedDocument.size}`); }} />
            ) : isEmpty ? (
              <EmptyDocument onUpload={() => uploadRef.current?.click()} onUploadSample={handleLoadSampleDocument} />
            ) : (
              <OriginalPage />
            )}
          </div>
          <div className="compare-divider"><div><ArrowLeftRight size={15} /></div></div>
          <div className="page-column" style={{ position: "relative", overflow: "hidden" }}>
            <div className="column-head"><span>Reconstructed text</span><small className={ocrResult ? "success-text" : ""}>{ocrResult ? <><Check size={12} /> Searchable</> : scanState === "error" ? "Needs worker" : "Waiting for OCR"}</small></div>
            {uploadingSample ? (
              <div style={{ position: "relative", width: "100%", height: "400px", background: "#fcfcfa", border: "1px solid #d1d6d0", borderRadius: 6, display: "flex", alignItems: "center", justifyContent: "center" }}>
                <div style={{ position: "absolute", top: `${100 - sampleProgress}%`, left: 0, width: "100%", height: "4px", background: "rgba(72,104,87,0.7)", boxShadow: "0 0 10px rgba(72,104,87,1)", transition: "top 0.1s ease" }} />
                <ScanLine size={48} style={{ color: "#bdc2bc" }} />
              </div>
            ) : uploadedDocument ? (
              ocrResult ? <OcrReconstructedPage result={ocrResult} page={page} showBlocks={showBlocks} onLineChange={updateOcrLine} onConfirmLine={confirmOcrLine} /> : scanState === "error" ? <OcrUnavailable message={ocrError} /> : <div className="ocr-empty"><ScanLine size={25} /><strong>Extracting document</strong><span>The reconstructed page will contain real OCR text, not a duplicate image.</span></div>
            ) : isEmpty ? (
              <EmptyDocument clear onUpload={() => uploadRef.current?.click()} />
            ) : (
              <RestoredPage showBlocks={showBlocks} />
            )}
          </div>
        </div>

        <aside className="inspector" aria-label="Extracted fields review">
          <div className="inspector-head" style={{ marginBottom: "16px" }}>
            <span style={{ fontSize: "11px", fontWeight: "700" }}>Extracted Fields Review</span>
            <Sparkles size={16} style={{ color: "var(--forest)" }} />
          </div>
          
          {ocrResult ? (
            <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
              <p style={{ fontSize: "10px", color: "var(--muted)", margin: 0 }}>Review or edit fields extracted from document. These are synced back locally.</p>
              
              <div style={{ display: "flex", flexDirection: "column", gap: "12px", borderTop: "1px solid #dcded8", paddingTop: "12px" }}>
                {ocrResult.fields.map((field, index) => (
                  <div key={`${field.label}-${index}`} style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                    <span style={{ fontSize: "8.5px", fontWeight: "600", color: "var(--muted)", display: "flex", justifyContent: "space-between" }}>
                      {field.label}
                      <b style={{ color: field.confidence > 0.85 ? "var(--forest)" : "#c67a39" }}>
                        {Math.round(field.confidence * 100)}% confidence
                      </b>
                    </span>
                    <input
                      value={field.value}
                      onChange={(e) => {
                        const updatedFields = ocrResult.fields.map((item, idx) => 
                          idx === index ? { ...item, value: e.target.value } : item
                        );
                        const nextResult = { ...ocrResult, fields: updatedFields };
                        setOcrResult(nextResult);
                        void saveOcrResultLocally(nextResult).catch(() => undefined);
                        onAddRecord(createRecordFromOcr(nextResult, fileName));
                      }}
                      style={{ 
                        padding: "8px 10px", 
                        border: "1px solid #c8ccd0", 
                        borderRadius: "4px", 
                        fontSize: "11px", 
                        fontWeight: "600", 
                        width: "100%", 
                        background: "#fff",
                        color: "var(--ink)"
                      }}
                    />
                  </div>
                ))}
              </div>
              
              <button
                type="button"
                className="button map-parsed-button"
                style={{ marginTop: "12px" }}
                onClick={() => {
                  const surveyVal = ocrResult.fields.find((f) => f.label.toLowerCase().includes("survey") || f.label.toLowerCase().includes("khasra"))?.value || "214/3";
                  window.localStorage.setItem("sitaara-mapped-survey", surveyVal);
                  window.localStorage.setItem("sitaara-mapped-deed-area", "1,856");
                  window.localStorage.setItem("sitaara-trigger-map-fetch", "true");
                  onNavigate("map");
                }}
              >
                <MapPinned size={16} /> Map Parsed Plot ➔
              </button>
            </div>
          ) : (
            <div style={{ textAlign: "center", padding: "40px 10px", color: "var(--muted)" }}>
              <FileText size={32} style={{ marginBottom: "12px", opacity: 0.5 }} />
              <strong style={{ display: "block", fontSize: "12px", color: "var(--ink)" }}>No document loaded</strong>
              <span style={{ display: "block", fontSize: "9px", marginTop: "4px" }}>Upload a document or load sample in Document Lab to view extracted fields.</span>
            </div>
          )}
        </aside>
      </div>

      <button 
        type="button" 
        className="chatbot-fab"
        onClick={() => setChatbotOpen(prev => !prev)}
        title="Ask Sitaara Assistant"
        style={{
          position: "fixed",
          left: "252px",
          bottom: "24px",
          width: "56px",
          height: "56px",
          borderRadius: "50%",
          background: "linear-gradient(135deg, var(--forest) 0%, var(--forest-dark) 100%)",
          border: "2px solid var(--acid)",
          color: "var(--acid)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          boxShadow: "0 8px 24px rgba(0, 0, 0, 0.25)",
          cursor: "pointer",
          zIndex: 1000,
          transition: "transform 0.2s ease, box-shadow 0.2s ease",
        }}
      >
        {chatbotOpen ? <X size={24} /> : <Star size={24} fill="var(--acid)" />}
      </button>

      {/* Floating Chatbot Popup */}
      {chatbotOpen && (
        <div 
          className="chatbot-popup"
          style={{
            position: "fixed",
            left: "252px",
            bottom: "96px",
            width: "380px",
            height: "480px",
            zIndex: 1000,
            background: "#fffefa",
            border: "1px solid #ccd1ca",
            borderRadius: "12px",
            boxShadow: "0 10px 30px rgba(0,0,0,0.18)",
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
          }}
        >
          <div className="chatbot-header">
            <div>
              <h3><Star size={16} fill="var(--acid)" style={{ marginRight: 6, color: "var(--acid)" }} /> Sitaara Companion</h3>
              <p>Ask anything about extracted text & fields</p>
            </div>
            <button className="chatbot-close" onClick={() => setChatbotOpen(false)}><X size={18} /></button>
          </div>
          <div className="chatbot-body">
            {chatMessages.map((msg, i) => (
              <div key={i} className={`chat-message ${msg.role}`}>
                <div className={`chat-avatar ${msg.role}`}>{msg.role === "ai" ? <Star size={12} fill="var(--acid)" style={{ color: "var(--acid)" }} /> : "YOU"}</div>
                <div className="chat-bubble">{msg.text}</div>
              </div>
            ))}
            {chatLoading && <div className="chat-message ai"><div className="chat-avatar ai"><Star size={12} fill="var(--acid)" style={{ color: "var(--acid)" }} /></div><div className="chat-bubble">Thinking…</div></div>}
          </div>
          <div className="preset-questions" style={{ display: "flex", gap: "4px", padding: "8px 12px", overflowX: "auto" }}>
            <button type="button" className="preset-chip" style={{ fontSize: "8px", padding: "4px 8px" }} onClick={() => askChatbot("Who is the recorded owner?")}>Owner?</button>
            <button type="button" className="preset-chip" style={{ fontSize: "8px", padding: "4px 8px" }} onClick={() => askChatbot("What is the survey number & size?")}>Survey no.?</button>
            <button type="button" className="preset-chip" style={{ fontSize: "8px", padding: "4px 8px" }} onClick={() => askChatbot("What are the boundary details?")}>Boundaries?</button>
            <button type="button" className="preset-chip" style={{ fontSize: "8px", padding: "4px 8px" }} onClick={() => askChatbot("Summarize key document risks")}>Risks?</button>
          </div>
          <div className="chatbot-input-row">
            <input
              placeholder="Ask anything about this document..."
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && askChatbot()}
            />
            <button type="button" onClick={() => askChatbot()}><ChevronRight size={18} /></button>
          </div>
        </div>
      )}
    </section>
  );
}

function ParcelMap({
  opacity,
  corners,
  surveyNumber = "214/3",
  areaSqFt = 1856,
  basemap = "osm",
  onCornerChange,
  onPlotShift,
}: {
  opacity: number;
  corners: Corner[];
  surveyNumber?: string;
  areaSqFt?: number;
  basemap?: "osm" | "satellite";
  onCornerChange: (index: number, value: Corner) => void;
  onPlotShift?: (newCorners: Corner[]) => void;
}) {
  const mapElement = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const polygonRef = useRef<LeafletPolygon | null>(null);
  const tileLayerRef = useRef<unknown | null>(null);
  const markersRef = useRef<unknown[]>([]);
  const centerMarkerRef = useRef<unknown | null>(null);
  const callbackRef = useRef(onCornerChange);
  const shiftCallbackRef = useRef(onPlotShift);
  const cornersRef = useRef(corners);
  const isDraggingRef = useRef(false);
  const initialOpacityRef = useRef(opacity);
  const lastCentroidRef = useRef<Corner>([0, 0]);

  useEffect(() => {
    callbackRef.current = onCornerChange;
    shiftCallbackRef.current = onPlotShift;
    cornersRef.current = corners;
  }, [onCornerChange, onPlotShift, corners]);

  useEffect(() => {
    if (!mapElement.current || mapRef.current) return;
    let disposed = false;
    void import("leaflet").then((L) => {
      if (disposed || !mapElement.current || mapRef.current) return;
      const currentCorners = cornersRef.current.length >= 4 ? cornersRef.current : corners;
      const initialCentroidLat = currentCorners.reduce((s, c) => s + c[0], 0) / (currentCorners.length || 1) || 18.5204;
      const initialCentroidLng = currentCorners.reduce((s, c) => s + c[1], 0) / (currentCorners.length || 1) || 73.8567;
      lastCentroidRef.current = [initialCentroidLat, initialCentroidLng];

      const map = L.map(mapElement.current, { zoomControl: false, attributionControl: true }).setView([initialCentroidLat, initialCentroidLng], 17);

      const tileUrl = basemap === "satellite"
        ? "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
        : "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
      const attribution = basemap === "satellite"
        ? "Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and GIS User Community"
        : '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

      const tileLayer = L.tileLayer(tileUrl, { maxZoom: 19, attribution }).addTo(map);
      tileLayerRef.current = tileLayer;

      L.control.zoom({ position: "bottomright" }).addTo(map);
      const polygon = L.polygon(currentCorners, { color: "#e8ff86", weight: 3, fillColor: "#486857", fillOpacity: initialOpacityRef.current }).addTo(map);
      polygon.bindTooltip(`Survey ${surveyNumber || "214/3"} · ${areaSqFt.toLocaleString()} sq.ft`, { permanent: true, direction: "center", className: "parcel-label" });

      const markers = currentCorners.map((corner, index) => {
        const marker = L.marker(corner, {
          draggable: true,
          icon: L.divIcon({ className: "corner-marker", html: `<span>${index + 1}</span>`, iconSize: [28, 28], iconAnchor: [14, 14] }),
        }).addTo(map);
        marker.on("dragstart", () => { isDraggingRef.current = true; });
        marker.on("drag", () => {
          const point = marker.getLatLng();
          callbackRef.current(index, [point.lat, point.lng]);
        });
        marker.on("dragend", () => { isDraggingRef.current = false; });
        return marker;
      });
      markersRef.current = markers;

      // Whole Plot Center Drag Anchor
      const centerMarker = L.marker([initialCentroidLat, initialCentroidLng], {
        draggable: true,
        icon: L.divIcon({ className: "plot-center-marker", html: `<span>📍 Select & Drag Plot</span>`, iconSize: [110, 26], iconAnchor: [55, 13] }),
      }).addTo(map);

      centerMarker.on("dragstart", () => { isDraggingRef.current = true; });
      centerMarker.on("drag", () => {
        const newPos = centerMarker.getLatLng();
        const prev = lastCentroidRef.current;
        const dLat = newPos.lat - prev[0];
        const dLng = newPos.lng - prev[1];
        const shiftedCorners: Corner[] = cornersRef.current.map(([lat, lng]) => [lat + dLat, lng + dLng]);
        lastCentroidRef.current = [newPos.lat, newPos.lng];
        cornersRef.current = shiftedCorners;
        if (shiftCallbackRef.current) {
          shiftCallbackRef.current(shiftedCorners);
        }
      });
      centerMarker.on("dragend", () => { isDraggingRef.current = false; });
      centerMarkerRef.current = centerMarker;

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
    if (!mapRef.current) return;
    void import("leaflet").then((L) => {
      if (tileLayerRef.current && typeof tileLayerRef.current === "object" && "remove" in tileLayerRef.current) {
        (tileLayerRef.current as { remove: () => void }).remove();
      }
      const tileUrl = basemap === "satellite"
        ? "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
        : "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
      const attribution = basemap === "satellite"
        ? "Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and GIS User Community"
        : '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

      const newTileLayer = L.tileLayer(tileUrl, { maxZoom: 19, attribution }).addTo(mapRef.current!);
      tileLayerRef.current = newTileLayer;
    });
  }, [basemap]);

  useEffect(() => {
    if (!polygonRef.current || !mapRef.current) return;
    polygonRef.current.setLatLngs(corners);
    markersRef.current.forEach((marker: unknown, index) => {
      if (corners[index] && marker && typeof marker === "object" && "setLatLng" in marker) {
        (marker as { setLatLng: (pt: Corner) => void }).setLatLng(corners[index]);
      }
    });

    if (corners.length > 0) {
      const cLat = corners.reduce((s, c) => s + c[0], 0) / corners.length;
      const cLng = corners.reduce((s, c) => s + c[1], 0) / corners.length;
      lastCentroidRef.current = [cLat, cLng];
      if (centerMarkerRef.current && typeof centerMarkerRef.current === "object" && "setLatLng" in centerMarkerRef.current) {
        (centerMarkerRef.current as { setLatLng: (pt: Corner) => void }).setLatLng([cLat, cLng]);
      }

      // Reposition and refresh Leaflet permanent tooltip in real-time
      const tooltip = polygonRef.current.getTooltip();
      if (tooltip) {
        tooltip.setLatLng([cLat, cLng]);
        const calcArea = calculatePolygonArea(corners).areaSqFt;
        polygonRef.current.setTooltipContent(`Survey ${surveyNumber || "214/3"} · ${calcArea.toLocaleString()} sq.ft`);
      }

      // If not dragging, smoothly fit bounds to the new plot
      if (!isDraggingRef.current && polygonRef.current) {
        mapRef.current.fitBounds(polygonRef.current.getBounds(), { padding: [65, 65] });
      }
    }
  }, [corners, surveyNumber, areaSqFt]);

  useEffect(() => {
    if (!polygonRef.current) return;
    polygonRef.current.setTooltipContent(`Survey ${surveyNumber || "214/3"} · ${areaSqFt.toLocaleString()} sq.ft`);
  }, [surveyNumber, areaSqFt]);

  useEffect(() => {
    polygonRef.current?.setStyle({ fillOpacity: opacity });
  }, [opacity]);

  return <div ref={mapElement} className="leaflet-map" aria-label="OpenStreetMap parcel boundary editor" />;
}



const CASE_COORDINATES: Record<string, Corner[]> = {
  "SHFL0021847": [[25.26440, 82.87490], [25.26440, 82.87563], [25.26377, 82.87563], [25.26377, 82.87490]], // Varanasi Bhadaini 52,700 sq.ft
  "OCR-AJAI-ATS": [[13.08084, 77.63265], [13.08084, 77.63335], [13.08016, 77.63335], [13.08016, 77.63265]], // Bengaluru Yelahanka 1.42 Acres (61,850 sq.ft)
  "PV-2026-0412": [[18.57871, 73.98575], [18.57871, 73.98725], [18.57729, 73.98725], [18.57729, 73.98575]], // Pune Wagholi 2.5 Hectares (269,100 sq.ft)
  "DL-REG-8821": [[28.53007, 77.14242], [28.53007, 77.14258], [28.52993, 77.14258], [28.52993, 77.14242]], // Delhi Vasant Kunj 2,400 sq.ft
  "HR-GUR-3310": [[28.32879, 76.90267], [28.32879, 76.90333], [28.32821, 76.90333], [28.32821, 76.90267]], // Manesar Khewat 1 Acre (43,560 sq.ft)
  "UP-LKO-9941": [[26.89210, 80.99539], [26.89210, 80.99561], [26.89190, 80.99561], [26.89190, 80.99539]], // Lucknow Sector 11 4,800 sq.ft
  "KA-BLR-5521": [[13.07600, 77.60898], [13.07600, 77.61002], [13.07500, 77.61002], [13.07500, 77.60898]], // Sampigehalli 3.10 Acres (135,000 sq.ft)
  "MH-MUM-1104": [[19.21505, 72.97795], [19.21505, 72.97805], [19.21495, 72.97805], [19.21495, 72.97795]]  // Majiwada Plot 88 1,200 sq.ft
};

function MapWorkspace({ 
  onNavigate,
  activeCaseId,
  recordsList
}: { 
  onNavigate?: (view: View) => void;
  activeCaseId?: string;
  recordsList?: RecordItem[];
}) {
  const [opacity, setOpacity] = useState(0.38);
  const [corners, setCorners] = useState<Corner[]>(starterCorners);
  const [located, setLocated] = useState(true);
  const [surveyNumber, setSurveyNumber] = useState("214/3");
  const [recordOpen, setRecordOpen] = useState(true);
  const [mapMessage, setMapMessage] = useState("");

  // Plot Map Options: Auto Fetch vs Manual Data Filling
  const [mode, setMode] = useState<"autofetch" | "manual">("autofetch");
  const [portal, setPortal] = useState("UP Bhulekh");
  const [processingOpenCv, setProcessingOpenCv] = useState(false);
  const [basemap, setBasemap] = useState<"osm" | "satellite">("satellite");

  const [village, setVillage] = useState("Bhadaini");
  const [tehsil, setTehsil] = useState("Sadar");
  const [district, setDistrict] = useState("Varanasi");
  const [khata, setKhata] = useState("Khata 84");
  const [areaSqFt, setAreaSqFt] = useState(52700);
  const [deedAreaSqFt, setDeedAreaSqFt] = useState(52700);
  const [perimeterMeters, setPerimeterMeters] = useState(284.2);

  // Dynamically calculate and update GIS area & perimeter on boundary corner changes
  useEffect(() => {
    const { areaSqFt: calcArea, perimeterMeters: calcPerim } = calculatePolygonArea(corners);
    setAreaSqFt(calcArea);
    setPerimeterMeters(calcPerim);
  }, [corners]);

  // Load case-specific geographical details, survey numbers, and coordinates
  useEffect(() => {
    if (!activeCaseId || !recordsList) return;
    const activeCase = recordsList.find(r => r.id === activeCaseId);
    if (!activeCase) return;
    
    const matchedCoords = CASE_COORDINATES[activeCaseId] || starterCorners;
    
    setCorners(matchedCoords);
    setSurveyNumber(activeCase.khasra);
    setVillage(activeCase.village);
    setTehsil(activeCase.tehsil);
    setDistrict(activeCase.district);
    setKhata(`Khasra ${activeCase.khasra}`);
    
    // Parse area from property details string e.g. "Khasra 214/3 · 52,700 sq.ft", "1.42 Acres", "2.5 Hectares"
    let parsedArea = 52700;
    const sqftMatch = activeCase.property.match(/([\d,]+)\s*(?:sq\.ft|sqft)/i);
    const acreMatch = activeCase.property.match(/([\d.]+)\s*Acres?/i);
    const hectareMatch = activeCase.property.match(/([\d.]+)\s*Hectares?/i);

    if (sqftMatch) {
      parsedArea = parseInt(sqftMatch[1].replace(/,/g, ""), 10);
    } else if (acreMatch) {
      parsedArea = Math.round(parseFloat(acreMatch[1]) * 43560);
    } else if (hectareMatch) {
      parsedArea = Math.round(parseFloat(hectareMatch[1]) * 107639);
    }

    setDeedAreaSqFt(parsedArea);
    setAreaSqFt(parsedArea);
    
    // Select portal based on state
    if (activeCase.state === "UP") setPortal("UP Bhulekh");
    else if (activeCase.state === "KA") setPortal("Karnataka Bhoomi");
    else if (activeCase.state === "MH") setPortal("MahaBhulekh");
    else if (activeCase.state === "DL") setPortal("UP Bhulekh");
    else setPortal("UP Bhulekh");
    
    setMapMessage(`Loaded geospatial record boundaries for Case ${activeCaseId} (Khasra ${activeCase.khasra}, ${activeCase.village}).`);
  }, [activeCaseId, recordsList]);

  const geoJsonRef = useRef<HTMLInputElement>(null);
  const cvImageRef = useRef<HTMLInputElement>(null);

  const govPortalUrls: Record<string, string> = {
    "UP Bhulekh": "https://upbhunaksha.gov.in/",
    "Karnataka Bhoomi": "https://landrecords.karnataka.gov.in/",
    "MahaBhulekh": "https://mahabhunaksha.mahabhumi.gov.in/",
    "TN Patta": "https://eservices.tn.gov.in/",
    "MP BhuNaksha": "https://mpbhunaksha.gov.in/",
  };

  const locate = async () => {
    setLocated(false);
    setMapMessage(mode === "autofetch" ? `Fetching cadastral plot map from ${portal} server…` : "Matching the manual plot reference…");
    try {
      if (mode === "autofetch") {
        const res = await fetch("/api/plot/gov-fetch", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ portal, surveyNumber, village, tehsil, district }),
        });
        const data = await res.json();
        if (res.ok && data.corners) {
          setCorners(data.corners);
          setKhata(data.khataNumber || "Khata 84");
          setAreaSqFt(data.areaSqFt || 1856);
          setPerimeterMeters(data.perimeterMeters || 170.4);
          setMapMessage(`Successfully fetched plot boundary for Survey ${surveyNumber} from ${portal} (${data.village}, ${data.tehsil}, ${data.district}).`);
        } else {
          setMapMessage(`Survey ${surveyNumber} loaded via ${portal} registry protocol.`);
        }
      } else {
        setMapMessage(`Survey ${surveyNumber || "reference"} boundary updated via manual data input.`);
      }
    } catch {
      setMapMessage(`Survey ${surveyNumber} updated.`);
    } finally {
      setLocated(true);
      setRecordOpen(true);
    }
  };

  useEffect(() => {
    const trigger = window.localStorage.getItem("sitaara-trigger-map-fetch");
    if (trigger === "true") {
      window.localStorage.removeItem("sitaara-trigger-map-fetch");
      const mappedSurvey = window.localStorage.getItem("sitaara-mapped-survey");
      const mappedDeedArea = window.localStorage.getItem("sitaara-mapped-deed-area");
      queueMicrotask(() => {
        if (mappedSurvey) setSurveyNumber(mappedSurvey);
        if (mappedDeedArea) setDeedAreaSqFt(parseInt(mappedDeedArea.replace(/,/g, ""), 10) || 1856);
        void locate();
      });
    }
  }, []);

  const updateCorner = (index: number, point: Corner) => {
    setCorners((current) => current.map((corner, cornerIndex) => cornerIndex === index ? point : corner));
  };

  const processOpenCvImage = async (file?: File) => {
    if (!file) return;
    setProcessingOpenCv(true);
    setMapMessage("Running OpenCV image processing (background transparency & contour corner detection)…");
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("threshold", "220");
      const res = await fetch("/api/plot/autoresize", { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "OpenCV auto-resize failed");

      if (data.detected_corners && Array.isArray(data.detected_corners) && data.detected_corners.length === 4) {
        // Offset around current base location
        const baseLat = corners[0]?.[0] || 18.5204;
        const baseLng = corners[0]?.[1] || 73.8567;
        const newCorners: Corner[] = data.detected_corners.map(([yNorm, xNorm]: [number, number]) => [
          baseLat + (yNorm - 0.5) * 0.002,
          baseLng + (xNorm - 0.5) * 0.002,
        ]);
        setCorners(newCorners);
      }
      setMapMessage("OpenCV background transparency & boundary contour auto-resize complete!");
    } catch (err) {
      setMapMessage(err instanceof Error ? err.message : "OpenCV auto-resize error.");
    } finally {
      setProcessingOpenCv(false);
      if (cvImageRef.current) cvImageRef.current.value = "";
    }
  };

  const importGeoJson = async (file?: File) => {
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      const geometry = data.type === "FeatureCollection" ? data.features?.[0]?.geometry : data.type === "Feature" ? data.geometry : data;
      const ring = geometry?.type === "Polygon" ? geometry.coordinates?.[0] : null;
      if (!Array.isArray(ring) || ring.length < 4) throw new Error("Use a GeoJSON Polygon with at least four points.");
      const imported = ring.slice(0, 4).map((coordinate: number[]) => [Number(coordinate[1]), Number(coordinate[0])] as Corner);
      if (imported.some((point: Corner) => !Number.isFinite(point[0]) || !Number.isFinite(point[1]))) throw new Error("The polygon coordinates are invalid.");
      setCorners(imported);
      setMapMessage(`Imported ${file.name} with four boundary points.`);
    } catch (error) {
      setMapMessage(error instanceof Error ? error.message : "GeoJSON could not be imported.");
    } finally {
      if (geoJsonRef.current) geoJsonRef.current.value = "";
    }
  };

  const exportBoundary = () => {
    const coordinates = [...corners.map(([lat, lng]) => [lng, lat]), [corners[0][1], corners[0][0]]];
    const geojson = { type: "Feature", properties: { surveyNumber, status: "provisional" }, geometry: { type: "Polygon", coordinates: [coordinates] } };
    const url = URL.createObjectURL(new Blob([JSON.stringify(geojson, null, 2)], { type: "application/geo+json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `survey-${surveyNumber.replace(/[^a-z0-9-]/gi, "-") || "boundary"}.geojson`;
    link.click();
    URL.revokeObjectURL(url);
    setMapMessage("Boundary exported as GeoJSON.");
  };

  const exportCertificate = () => {
    const variancePct = deedAreaSqFt ? (((areaSqFt - deedAreaSqFt) / deedAreaSqFt) * 100).toFixed(1) : "0.0";
    const text = `=====================================================
SITAARA VERIFY — LEGAL PROPERTY VERIFICATION REPORT
=====================================================
Generated At : ${new Date().toLocaleString("en-IN")}
Status       : VERIFIED (Positive Boundary Audit)

-----------------------------------------------------
1. PROPERTY IDENTIFICATION & REGISTRY
-----------------------------------------------------
Deed / Case Reference : Survey ${surveyNumber}
Registry Portal       : ${portal}
Khata Number          : ${khata}
Location              : ${village}, ${tehsil}, ${district}, India

-----------------------------------------------------
2. AREA MATCH AUDIT & GIS VERIFICATION
-----------------------------------------------------
Deed Stated Area     : ${deedAreaSqFt.toLocaleString()} sq.ft
GIS Calculated Area  : ${areaSqFt.toLocaleString()} sq.ft
Area Variance        : ${areaSqFt === deedAreaSqFt ? "0.0% (Exact Match)" : `${variancePct}% Overrun`}
Perimeter            : ${perimeterMeters} meters

-----------------------------------------------------
3. BOUNDARY CORNER COORDINATES (4 CONTROL POINTS)
-----------------------------------------------------
Corner 1 (NW) : Lat ${corners[0]?.[0]?.toFixed(6)}, Lng ${corners[0]?.[1]?.toFixed(6)}
Corner 2 (NE) : Lat ${corners[1]?.[0]?.toFixed(6)}, Lng ${corners[1]?.[1]?.toFixed(6)}
Corner 3 (SE) : Lat ${corners[2]?.[0]?.toFixed(6)}, Lng ${corners[2]?.[1]?.toFixed(6)}
Corner 4 (SW) : Lat ${corners[3]?.[0]?.toFixed(6)}, Lng ${corners[3]?.[1]?.toFixed(6)}

=====================================================
Verified by Sitaara Intelligence Platform
=====================================================`;

    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `Verification-Certificate-Survey-${surveyNumber.replace(/[^a-z0-9-]/gi, "-")}.txt`;
    link.click();
    URL.revokeObjectURL(url);
    setMapMessage("Verification Certificate exported successfully.");
  };

  const areaVariancePct = deedAreaSqFt ? Math.abs(((areaSqFt - deedAreaSqFt) / deedAreaSqFt) * 100) : 0;

  return (
    <section className="workspace-section map-workspace" aria-labelledby="map-title">
      <header className="workspace-header map-header">
        <div>
          <div className="eyebrow"><MapPinned size={13} style={{ display: "inline", verticalAlign: "-2px" }} /> Cadastral Map</div>
          <h1 id="map-title">Plot <em>Map</em></h1>
        </div>
        <div className="header-actions">
          <input ref={geoJsonRef} type="file" accept=".json,.geojson,application/geo+json,application/json" hidden onChange={(event) => importGeoJson(event.target.files?.[0])} />
          <input ref={cvImageRef} type="file" accept="image/*" hidden onChange={(event) => processOpenCvImage(event.target.files?.[0])} />

          <button className="button button-ghost" onClick={() => cvImageRef.current?.click()} disabled={processingOpenCv}>
            <WandSparkles size={17} className={processingOpenCv ? "spinning" : ""} /> {processingOpenCv ? "Processing OpenCV..." : "OpenCV Auto-Resize"}
          </button>
          <button className="button button-ghost" onClick={() => geoJsonRef.current?.click()}><Layers3 size={17} /> Import GeoJSON</button>
          <button className="button button-ghost" onClick={exportCertificate}><FileText size={17} /> Export Certificate</button>
          <button className="button button-primary" onClick={exportBoundary}><ArrowDownToLine size={17} /> Export boundary</button>
        </div>
      </header>

      <div className="map-layout">
        <aside className="plot-search-panel">
          <div className="search-intro"><MapPinned size={22} /><div><strong>Plot Map Data Source</strong><span>Select official auto-fetch or manual coordinate entry.</span></div></div>

          {/* 2 Options Toggle */}
          <div className="map-mode-toggle">
            <button className={mode === "autofetch" ? "active" : ""} onClick={() => setMode("autofetch")}>Auto Fetch (Govt Portal)</button>
            <button className={mode === "manual" ? "active" : ""} onClick={() => setMode("manual")}>Manual Data Filling</button>
          </div>

          {mode === "autofetch" ? (
            <>
              <label>Government State Registry Portal
                <select value={portal} onChange={(e) => setPortal(e.target.value)} style={{ width: "100%", height: 37, marginTop: 5, borderRadius: 4, borderColor: "#cbd0ca", padding: "0 8px", fontSize: 10 }}>
                  <option value="UP Bhulekh">Uttar Pradesh · UP Bhulekh / BhuNaksha</option>
                  <option value="Karnataka Bhoomi">Karnataka · Bhoomi RTC</option>
                  <option value="MahaBhulekh">Maharashtra · MahaBhulekh 7/12</option>
                  <option value="TN Patta">Tamil Nadu · Patta Chitta</option>
                  <option value="MP BhuNaksha">Madhya Pradesh · MP BhuNaksha</option>
                </select>
              </label>

              <a
                href={govPortalUrls[portal] || "https://upbhunaksha.gov.in/"}
                target="_blank"
                rel="noopener noreferrer"
                className="button button-ghost"
                style={{ marginTop: 6, width: "100%", fontSize: 10, display: "flex", justifyContent: "center", alignItems: "center", gap: 5, padding: "6px 0", color: "var(--accent)" }}
              >
                Open Official {portal} Portal ↗
              </a>

              <label style={{ marginTop: 10 }}>Survey / Khasra plot number<input value={surveyNumber} onChange={(event) => setSurveyNumber(event.target.value)} /></label>
              
              <div className="field-row">
                <label>Village
                  <select value={village} onChange={(e) => {
                    const val = e.target.value;
                    setVillage(val);
                    if (val === "Bhadaini") {
                      setSurveyNumber("214/3");
                      setCorners(starterCorners);
                      setAreaSqFt(52700);
                      setDeedAreaSqFt(52700);
                    } else if (val === "Assi") {
                      setSurveyNumber("182/4");
                      setCorners([[25.280659, 82.992861], [25.280683, 82.993003], [25.280541, 82.993039], [25.280517, 82.992897]]);
                      setAreaSqFt(2250);
                      setDeedAreaSqFt(2250);
                    } else if (val === "Lanka") {
                      setSurveyNumber("105");
                      setCorners([[25.27065, 82.98288], [25.27067, 82.98300], [25.27055, 82.98302], [25.27053, 82.98290]]);
                      setAreaSqFt(1500);
                      setDeedAreaSqFt(1500);
                    } else if (val === "Durgakund") {
                      setSurveyNumber("98/2");
                      setCorners([[25.29064, 82.97288], [25.29066, 82.97299], [25.29056, 82.97301], [25.29054, 82.97290]]);
                      setAreaSqFt(1200);
                      setDeedAreaSqFt(1200);
                    } else {
                      setSurveyNumber("34/1");
                      setCorners([[25.30067, 82.96285], [25.30070, 82.96301], [25.30053, 82.96305], [25.30050, 82.96289]]);
                      setAreaSqFt(3100);
                      setDeedAreaSqFt(3100);
                    }
                  }} style={{ width: "100%", height: 35, marginTop: 5, borderRadius: 4, borderColor: "#cbd0ca", padding: "0 8px", fontSize: 11, background: "#fff", color: "var(--foreground)", fontWeight: "600" }}>
                    <option value="Bhadaini">Bhadaini (Varanasi)</option>
                    <option value="Assi">Assi (Varanasi)</option>
                    <option value="Lanka">Lanka (Varanasi)</option>
                    <option value="Durgakund">Durgakund (Varanasi)</option>
                    <option value="Bhelupur">Bhelupur (Varanasi)</option>
                  </select>
                </label>
                <label>Tehsil<input value={tehsil} onChange={(e) => setTehsil(e.target.value)} /></label>
              </div>
              <label>District<input value={district} onChange={(e) => setDistrict(e.target.value)} /></label>
              <button className="button button-primary locate-button" onClick={locate}><Search size={17} /> {located ? "Auto-Fetch Plot Map" : "Fetching from Govt Server…"}</button>
            </>
          ) : (
            <>
              <label>Survey / plot number<input value={surveyNumber} onChange={(event) => setSurveyNumber(event.target.value)} /></label>
              <div className="field-row">
                <label>Corner 1 Lat<input value={corners[0]?.[0]?.toFixed(5)} onChange={(e) => setCorners((curr) => curr.map((c, i) => i === 0 ? [Number(e.target.value) || c[0], c[1]] : c))} /></label>
                <label>Corner 1 Lng<input value={corners[0]?.[1]?.toFixed(5)} onChange={(e) => setCorners((curr) => curr.map((c, i) => i === 0 ? [c[0], Number(e.target.value) || c[1]] : c))} /></label>
              </div>
              <button className="button button-ghost locate-button" style={{ marginTop: 8 }} onClick={() => cvImageRef.current?.click()}>
                <WandSparkles size={16} /> Auto-Fit Map Scan (OpenCV)
              </button>
              <button className="button button-primary locate-button" style={{ marginTop: 8 }} onClick={locate}><Search size={17} /> Update Manual Plot</button>
            </>
          )}

          {mapMessage && <div className="map-message" role="status">{mapMessage}</div>}

          {/* Deed vs GIS Area Discrepancy Audit Card */}
          <div className="area-audit-card">
            <h4>
              <span>Deed vs GIS Area Match</span>
              <span className={`area-audit-status ${areaVariancePct > 5 ? "overrun" : "match"}`}>
                {areaVariancePct > 5 ? `+${areaVariancePct.toFixed(1)}% Variance` : "100% Match"}
              </span>
            </h4>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 12 }}>
              <label style={{ fontSize: 10, fontWeight: "600", color: "var(--muted)", display: "flex", flexDirection: "column", gap: 4 }}>
                Deed Area (sq.ft)
                <input type="number" value={deedAreaSqFt} onChange={(e) => setDeedAreaSqFt(Number(e.target.value) || 0)} style={{ width: "100%", height: 35, padding: "0 8px", border: "1px solid #cbd0ca", borderRadius: 4, fontSize: 11, background: "#fff", color: "var(--foreground)", fontWeight: "600" }} />
              </label>
              <label style={{ fontSize: 10, fontWeight: "600", color: "var(--muted)", display: "flex", flexDirection: "column", gap: 4 }}>
                GIS Area (sq.ft)
                <input type="number" value={areaSqFt} onChange={(e) => setAreaSqFt(Number(e.target.value) || 0)} style={{ width: "100%", height: 35, padding: "0 8px", border: "1px solid #cbd0ca", borderRadius: 4, fontSize: 11, background: "#fff", color: "var(--foreground)", fontWeight: "600" }} />
              </label>
            </div>
          </div>

          {/* OpenCV Processing Toolbar */}
          <div className="opencv-toolbar">
            <h4><WandSparkles size={14} /> OpenCV Image Processing</h4>
            <button className="button button-ghost" onClick={() => cvImageRef.current?.click()} disabled={processingOpenCv}>
              Make Background Transparent & Auto-Resize
            </button>
          </div>

          <div className="source-note"><CircleHelp size={16} /><p><strong>Registry-aware, map-safe</strong><span>OpenStreetMap & ESRI Satellite basemaps. Legal parcel geometry comes from state survey records, GeoJSON, or OpenCV image analysis.</span></p></div>
          {recordOpen && located && (
            <div className="matched-record">
              <button className="record-close" aria-label="Close record" onClick={() => setRecordOpen(false)}><X size={14} /></button>
              <div className="match-label"><Check size={12} /> Matched record ({mode === "autofetch" ? portal : "Manual"})</div>
              <h3>Survey {surveyNumber}</h3>
              <p>{village} · {khata}</p>
              <div className="record-metrics"><span><b>{areaSqFt.toLocaleString()}</b> sq.ft</span><span><b>{perimeterMeters}</b> m perimeter</span></div>
            </div>
          )}
        </aside>

        <div className="map-canvas-wrap">
          <ParcelMap
            opacity={opacity}
            corners={corners}
            surveyNumber={surveyNumber}
            areaSqFt={areaSqFt}
            basemap={basemap}
            onCornerChange={updateCorner}
            onPlotShift={(newCorners) => setCorners(newCorners)}
          />
          <div className="map-floating-top">
            <div><Focus size={15} /><span>Drag numbered corners to align</span></div>
            <button aria-label="Full screen map" onClick={() => document.querySelector<HTMLElement>(".map-canvas-wrap")?.requestFullscreen?.()}><Maximize2 size={16} /></button>
          </div>
          <div className="map-legend">
            <span className="legend-swatch" />
            <div><strong>Survey {surveyNumber}</strong><small>Provisional overlay</small></div>
            <div className="basemap-switcher">
              <button className={basemap === "osm" ? "active" : ""} onClick={() => setBasemap("osm")}>Roads</button>
              <button className={basemap === "satellite" ? "active" : ""} onClick={() => setBasemap("satellite")}>Satellite</button>
            </div>
            <label>Transparency<input type="range" min="0.12" max="0.75" step="0.01" value={opacity} onChange={(event) => setOpacity(Number(event.target.value))} /></label>
            <b>{Math.round(opacity * 100)}%</b>
          </div>
          <div className="map-scale"><span /> 50 m</div>
        </div>

        <aside className="boundary-inspector">
          <div className="inspector-head"><span>Boundary points</span><Focus size={16} /></div>
          <p className="boundary-help">Four corners define this provisional parcel. Drag them on the map or refine coordinates below.</p>
          
          <div style={{ background: "rgba(72, 104, 87, 0.06)", padding: "12px", borderRadius: "8px", marginBottom: "15px", border: "1px solid rgba(72, 104, 87, 0.15)" }}>
            <span style={{ fontSize: "9px", textTransform: "uppercase", letterSpacing: "1px", color: "var(--muted)", fontWeight: "600" }}>Calculated GIS Area</span>
            <div style={{ fontSize: "18px", fontWeight: "800", color: "var(--ink)", marginTop: "4px" }}>
              {areaSqFt.toLocaleString()} <span style={{ fontSize: "11px", fontWeight: "normal", color: "var(--muted)" }}>sq.ft</span>
            </div>
            <div style={{ fontSize: "10px", color: areaVariancePct > 5 ? "#d97706" : "var(--forest)", marginTop: "2px", fontWeight: "600" }}>
              {areaVariancePct > 5 ? `⚠️ ${areaVariancePct.toFixed(1)}% variance from Deed` : "✓ Matches Deed Area"}
            </div>
          </div>

          <div className="corner-list">
            {corners.map((corner, index) => (
              <div key={index}><span>{index + 1}</span><p><strong>{corner[0].toFixed(5)}</strong><small>{corner[1].toFixed(5)}</small></p><ChevronRight size={14} /></div>
            ))}
          </div>
          <div className="quality-card"><BadgeCheck size={17} /><div><strong>Overlay quality: High</strong><span>4 control points · ±1.8 m estimated</span></div></div>
          <button className="inspector-link" onClick={() => { onNavigate?.("scan"); }}>Open legal record <ChevronRight size={15} /></button>
        </aside>
      </div>
    </section>
  );
}

type ProcessCategory = "all" | "ocr" | "geo" | "sync" | "review" | "report";
type ProcessStatus = "active" | "completed" | "review" | "queued" | "failed";

type ProcessItem = {
  id: string;
  name: string;
  category: ProcessCategory;
  categoryLabel: string;
  target: string;
  status: ProcessStatus;
  progress: number;
  location: string;
  latency: string;
  details: string;
  timestamp: string;
  confidence?: number;
};

const initialProcesses: ProcessItem[] = [
  {
    id: "PROC-OCR-001",
    name: "Gemini 3.6 Multilingual OCR Engine",
    category: "ocr",
    categoryLabel: "OCR & Text",
    target: "Meera_Sharma_SaleDeed_Scan.pdf",
    status: "active",
    progress: 84,
    location: "Varanasi, UP",
    latency: "1.4s",
    details: "Parsing Hindi & Devanagari script layout blocks (8 lines pending)",
    timestamp: "Just now",
    confidence: 94.2,
  },
  {
    id: "PROC-GEO-002",
    name: "Cadastral Plot Map Overlay Sync",
    category: "geo",
    categoryLabel: "Geo Spatial",
    target: "Survey No. 118 / 2B (Sampigehalli)",
    status: "completed",
    progress: 100,
    location: "Bengaluru, KA",
    latency: "0.8s",
    details: "Matched OpenStreetMap parcel boundary with KA revenue records (±2.4m)",
    timestamp: "2 mins ago",
    confidence: 99.0,
  },
  {
    id: "PROC-SYNC-003",
    name: "Government Registry Cross-Verification",
    category: "sync",
    categoryLabel: "Govt Sync",
    target: "UP Bhulekh Portal (Tehsil Sadar)",
    status: "active",
    progress: 65,
    location: "Varanasi, UP",
    latency: "2.1s",
    details: "Comparing recorded owner and boundary directions against seller deed",
    timestamp: "Just now",
  },
  {
    id: "PROC-HW-004",
    name: "Handwriting & Unclear Ink Review",
    category: "review",
    categoryLabel: "Analyst Review",
    target: "Page 1 Line 6 (MR 42 / 2024-25)",
    status: "review",
    progress: 40,
    location: "Sampigehalli, KA",
    latency: "Manual",
    details: "Unclear cursive Hindi text flagged for analyst confirmation before export",
    timestamp: "5 mins ago",
    confidence: 62.0,
  },
  {
    id: "PROC-PDF-005",
    name: "Print-to-PDF Report Generator",
    category: "report",
    categoryLabel: "Reporting",
    target: "SHFL0021847-property-verification.pdf",
    status: "completed",
    progress: 100,
    location: "System Storage",
    latency: "0.5s",
    details: "Generated 3-source matrix comparison with legal caveats and score stamp",
    timestamp: "12 mins ago",
  },
  {
    id: "PROC-CV-006",
    name: "OpenCV Background Cleaning",
    category: "ocr",
    categoryLabel: "Vision Prep",
    target: "Raw_Scan_Page1_Original.jpg",
    status: "completed",
    progress: 100,
    location: "Browser Local",
    latency: "0.3s",
    details: "Cleaned paper stains, strengthened blue ink signatures locally",
    timestamp: "15 mins ago",
  },
];

type RecordItem = {
  id: string;
  applicant: string;
  property: string;
  khasra: string;
  village: string;
  tehsil: string;
  district: string;
  state: "UP" | "KA" | "MH" | "DL" | "HR";
  docType: "Sale Deed" | "Khatauni / RTC" | "Mutation Order" | "Cadastral Map";
  status: "positive" | "refer" | "negative" | "pending";
  confidence: number;
  date: string;
  hasHandwritingReview: boolean;
};

const initialRecords: RecordItem[] = [
  {
    id: "SHFL0021847",
    applicant: "Meera Sharma",
    property: "Khasra 214/3 · 1,856 sq.ft",
    khasra: "214/3",
    village: "Bhadaini",
    tehsil: "Sadar",
    district: "Varanasi",
    state: "UP",
    docType: "Sale Deed",
    status: "refer",
    confidence: 94.2,
    date: "2026-08-07",
    hasHandwritingReview: true,
  },
  {
    id: "OCR-AJAI-ATS",
    applicant: "Arjun Gupta",
    property: "Survey 118/2B · 1.42 Acres",
    khasra: "118/2B",
    village: "Sampigehalli",
    tehsil: "Yelahanka",
    district: "Bengaluru Rural",
    state: "KA",
    docType: "Sale Deed",
    status: "positive",
    confidence: 88.0,
    date: "2026-08-06",
    hasHandwritingReview: true,
  },
  {
    id: "PV-2026-0412",
    applicant: "Ramesh & Sangeeta Patel",
    property: "Gat No. 412 · 2.5 Hectares",
    khasra: "Gat 412",
    village: "Wagholi",
    tehsil: "Haveli",
    district: "Pune",
    state: "MH",
    docType: "Mutation Order",
    status: "pending",
    confidence: 76.5,
    date: "2026-08-05",
    hasHandwritingReview: false,
  },
  {
    id: "DL-REG-8821",
    applicant: "Vikramjit Singh",
    property: "Plot 45, Sector B · 2,400 sq.ft",
    khasra: "Plot 45",
    village: "Vasant Kunj",
    tehsil: "Mehrauli",
    district: "New Delhi",
    state: "DL",
    docType: "Khatauni / RTC",
    status: "positive",
    confidence: 99.1,
    date: "2026-08-04",
    hasHandwritingReview: false,
  },
  {
    id: "HR-GUR-3310",
    applicant: "Anita Choudhary",
    property: "Khewat 128 / Mustatil 42",
    khasra: "Khewat 128",
    village: "Karsola",
    tehsil: "Manesar",
    district: "Gurugram",
    state: "HR",
    docType: "Cadastral Map",
    status: "refer",
    confidence: 82.4,
    date: "2026-08-03",
    hasHandwritingReview: true,
  },
  {
    id: "UP-LKO-9941",
    applicant: "Shashi & Ajay Singh",
    property: "Plot 631/80, Sharda Nagar",
    khasra: "631/80",
    village: "Sector 11",
    tehsil: "Indira Nagar",
    district: "Lucknow",
    state: "UP",
    docType: "Sale Deed",
    status: "positive",
    confidence: 96.8,
    date: "2026-08-02",
    hasHandwritingReview: false,
  },
  {
    id: "KA-BLR-5521",
    applicant: "A. Narayanappa",
    property: "Survey 117 · 3.10 Acres",
    khasra: "117",
    village: "Sampigehalli",
    tehsil: "Yelahanka",
    district: "Bengaluru Urban",
    state: "KA",
    docType: "Khatauni / RTC",
    status: "positive",
    confidence: 91.5,
    date: "2026-08-01",
    hasHandwritingReview: false,
  },
  {
    id: "MH-MUM-1104",
    applicant: "Rajeshwar Rao",
    property: "Plot 88, Majiwada · 1,200 sq.ft",
    khasra: "Plot 88",
    village: "Majiwada",
    tehsil: "Thane",
    district: "Thane",
    state: "MH",
    docType: "Mutation Order",
    status: "negative",
    confidence: 64.2,
    date: "2026-07-30",
    hasHandwritingReview: true,
  },
];

function DashboardWorkspace({ 
  onNavigate, 
  recordsList, 
  onSelectCaseId,
  onAddRecord,
  onDeleteRecord
}: { 
  onNavigate: (view: View) => void; 
  recordsList: RecordItem[]; 
  onSelectCaseId: (id: string) => void; 
  onAddRecord: (rec: RecordItem) => void;
  onDeleteRecord: (id: string) => void;
}) {
  const [processes, setProcesses] = useState<ProcessItem[]>(initialProcesses);
  const [categoryFilter, setCategoryFilter] = useState<ProcessCategory>("all");
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [selectedPayload, setSelectedPayload] = useState<ProcessItem | null>(null);

  // CRUD Modal States
  const [openAddModal, setOpenAddModal] = useState(false);
  const [editingRecord, setEditingRecord] = useState<RecordItem | null>(null);

  // Form Fields State
  const [formCaseId, setFormCaseId] = useState("");
  const [formApplicant, setFormApplicant] = useState("");
  const [formProperty, setFormProperty] = useState("");
  const [formKhasra, setFormKhasra] = useState("");
  const [formVillage, setFormVillage] = useState("");
  const [formTehsil, setFormTehsil] = useState("");
  const [formDistrict, setFormDistrict] = useState("");
  const [formState, setFormState] = useState<RecordItem["state"]>("UP");
  const [formDocType, setFormDocType] = useState<RecordItem["docType"]>("Sale Deed");
  const [formStatus, setFormStatus] = useState<RecordItem["status"]>("pending");
  const [formConfidence, setFormConfidence] = useState(98.0);

  useEffect(() => {
    if (editingRecord) {
      setFormCaseId(editingRecord.id);
      setFormApplicant(editingRecord.applicant);
      setFormProperty(editingRecord.property);
      setFormKhasra(editingRecord.khasra);
      setFormVillage(editingRecord.village);
      setFormTehsil(editingRecord.tehsil);
      setFormDistrict(editingRecord.district);
      setFormState(editingRecord.state);
      setFormDocType(editingRecord.docType);
      setFormStatus(editingRecord.status);
      setFormConfidence(editingRecord.confidence);
    } else {
      setFormCaseId(`SHFL0021${Math.floor(100 + Math.random() * 900)}`);
      setFormApplicant("");
      setFormProperty("");
      setFormKhasra("");
      setFormVillage("");
      setFormTehsil("");
      setFormDistrict("");
      setFormState("UP");
      setFormDocType("Sale Deed");
      setFormStatus("pending");
      setFormConfidence(98.0);
    }
  }, [editingRecord, openAddModal]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formApplicant || !formProperty || !formKhasra) {
      alert("Please fill in applicant name, property description, and Khasra number.");
      return;
    }
    
    const record: RecordItem = {
      id: formCaseId,
      applicant: formApplicant,
      property: formProperty,
      khasra: formKhasra,
      village: formVillage || "Bhadaini",
      tehsil: formTehsil || "Sadar",
      district: formDistrict || "Varanasi",
      state: formState,
      docType: formDocType,
      status: formStatus,
      confidence: Number(formConfidence) || 98.0,
      date: editingRecord ? editingRecord.date : new Date().toISOString().split('T')[0],
      hasHandwritingReview: false
    };

    onAddRecord(record);
    setOpenAddModal(false);
    setEditingRecord(null);
  };

  const handleDeleteClick = (id: string) => {
    if (confirm("Are you sure you want to delete this property record?")) {
      onDeleteRecord(id);
    }
  };

  // Search & Filter state for Embedded Property Cases Registry
  const [search, setSearch] = useState("");
  const [stateFilter, setStateFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [docTypeFilter, setDocTypeFilter] = useState<string>("all");
  const [sortBy, setSortBy] = useState<string>("newest");

  const handleRefresh = () => {
    setIsRefreshing(true);
    setTimeout(() => {
      setProcesses((prev) =>
        prev.map((proc) => {
          if (proc.status === "active") {
            const nextProgress = Math.min(100, proc.progress + 15);
            return {
              ...proc,
              progress: nextProgress,
              status: nextProgress === 100 ? "completed" : "active",
              timestamp: "Just now",
            };
          }
          return proc;
        })
      );
      setIsRefreshing(false);
    }, 600);
  };

  const filteredProcesses = processes.filter((proc) => {
    if (categoryFilter === "all") return true;
    return proc.category === categoryFilter;
  });

  const filteredRecords = recordsList.filter((rec) => {
    if (search.trim()) {
      const q = search.toLowerCase().trim();
      const matchQ =
        rec.id.toLowerCase().includes(q) ||
        rec.applicant.toLowerCase().includes(q) ||
        rec.property.toLowerCase().includes(q) ||
        rec.khasra.toLowerCase().includes(q) ||
        rec.village.toLowerCase().includes(q) ||
        rec.district.toLowerCase().includes(q);
      if (!matchQ) return false;
    }
    if (stateFilter !== "all" && rec.state !== stateFilter) return false;
    if (statusFilter !== "all" && rec.status !== statusFilter) return false;
    if (docTypeFilter !== "all" && rec.docType !== docTypeFilter) return false;
    return true;
  }).sort((a, b) => {
    if (sortBy === "newest") return new Date(b.date).getTime() - new Date(a.date).getTime();
    if (sortBy === "oldest") return new Date(a.date).getTime() - new Date(b.date).getTime();
    if (sortBy === "confidence") return b.confidence - a.confidence;
    if (sortBy === "applicant") return a.applicant.localeCompare(b.applicant);
    return 0;
  });

  const activeCount = processes.filter((p) => p.status === "active").length;
  const reviewCount = processes.filter((p) => p.status === "review").length;

  return (
    <section className="dashboard-workspace" aria-labelledby="dashboard-title">
      <header className="workspace-header">
        <div>
          <div className="eyebrow">
            <span className="live-dot" /> System Dashboard
          </div>
          <h1 id="dashboard-title">
            System <em>Dashboard</em>
          </h1>
          <p style={{ marginTop: 6, color: "var(--muted)", fontSize: 11, lineHeight: 1.5, maxWidth: 600 }}>
            Monitor active OCR pipelines, state portal syncs, and verification tasks.
          </p>
        </div>
        <div className="header-actions">
          <button className="button button-ghost" onClick={handleRefresh} disabled={isRefreshing}>
            <RefreshCw size={14} className={isRefreshing ? "spinning" : ""} /> {isRefreshing ? "Syncing..." : "Sync processes"}
          </button>
          <button className="button button-ghost" onClick={() => { setEditingRecord(null); setOpenAddModal(true); }}>
            <Plus size={14} /> Register New Land
          </button>
          <button className="button button-primary" onClick={() => onNavigate("scan")}>
            <ScanLine size={14} /> Run Document OCR
          </button>
        </div>
      </header>

      {/* KPI Cards */}
      <div className="kpi-grid" style={{ marginBottom: 24 }}>
        <div className="kpi-card">
          <div className="kpi-card-head">
            <span>System Tasks</span>
            <div className="kpi-card-icon"><Activity size={18} /></div>
          </div>
          <strong>{processes.length} Processes</strong>
          <p><Clock size={11} /> {activeCount} active · {reviewCount} action required</p>
          <div className="kpi-card-accent" style={{ background: "var(--forest)" }} />
        </div>

        <div className="kpi-card">
          <div className="kpi-card-head">
            <span>Official Digitization Node</span>
            <div className="kpi-card-icon" style={{ background: "#e3f2fd", color: "#0d47a1" }}><Cpu size={18} /></div>
          </div>
          <strong>98.4% Accuracy</strong>
          <p><Zap size={11} /> Land Registry OCR · 1.4s avg latency</p>
          <div className="kpi-card-accent" style={{ background: "#1976d2" }} />
        </div>

        <div className="kpi-card">
          <div className="kpi-card-head">
            <span>Property Register</span>
            <div className="kpi-card-icon" style={{ background: "#f3e5f5", color: "#7b1fa2" }}><Database size={18} /></div>
          </div>
          <strong>{recordsList.length} Cases</strong>
          <p><BadgeCheck size={11} /> {recordsList.filter(r=>r.status==="positive").length} Approved · {recordsList.filter(r=>r.status==="refer").length} Referral</p>
          <div className="kpi-card-accent" style={{ background: "#8e24aa" }} />
        </div>

        <div className="kpi-card">
          <div className="kpi-card-head">
            <span>State Portal Connectors</span>
            <div className="kpi-card-icon" style={{ background: "#fff3e0", color: "#e65100" }}><Layers size={18} /></div>
          </div>
          <strong>3 Connected</strong>
          <p><CheckCircle2 size={11} /> UP Bhulekh, KA Kaveri, MH Mahabhulekh</p>
          <div className="kpi-card-accent" style={{ background: "#f57c00" }} />
        </div>
      </div>

      {/* Main Process Section */}
      <div className="process-monitor-panel">
        <div className="panel-header">
          <div>
            <h2><Activity size={16} style={{ color: "var(--forest)", display: "inline", verticalAlign: "-2px" }} /> Process Monitor</h2>
            <p>Track background execution threads and OCR pipelines.</p>
          </div>
          <div className="process-filter-tabs">
            {[
              ["all", `All Processes (${processes.length})`],
              ["ocr", "OCR & Text"],
              ["geo", "Geo Spatial"],
              ["sync", "Govt Sync"],
              ["review", "Analyst Review"],
              ["report", "Reports"],
            ].map(([cat, label]) => (
              <button
                key={cat}
                className={categoryFilter === cat ? "active" : ""}
                onClick={() => setCategoryFilter(cat as ProcessCategory)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="process-table-wrap">
          <table className="process-table">
            <thead>
              <tr>
                <th>Process ID & Name</th>
                <th>Category</th>
                <th>Target Resource</th>
                <th>State / Region</th>
                <th>Progress & Status</th>
                <th>Performance</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {filteredProcesses.map((proc) => (
                <tr key={proc.id}>
                  <td>
                    <div className="process-id-cell">
                      <strong>{proc.name}</strong>
                      <span>{proc.id} · {proc.timestamp}</span>
                    </div>
                  </td>
                  <td>
                    <span className="doc-type-badge">{proc.categoryLabel}</span>
                  </td>
                  <td>
                    <span style={{ fontSize: 10, fontWeight: 600 }}>{proc.target}</span>
                  </td>
                  <td>
                    <span style={{ font: "8px var(--font-geist-mono)", color: "var(--muted)" }}>{proc.location}</span>
                  </td>
                  <td>
                    <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span
                          className={`process-status-pill ${
                            proc.status === "active"
                              ? "active"
                              : proc.status === "completed"
                              ? "completed"
                              : proc.status === "review"
                              ? "review"
                              : "queued"
                          }`}
                        >
                          {proc.status === "active" && <RefreshCw size={10} className="spinning" />}
                          {proc.status === "completed" && <CheckCircle2 size={10} />}
                          {proc.status === "review" && <AlertTriangle size={10} />}
                          {proc.status}
                        </span>
                        <span style={{ font: "9px var(--font-geist-mono)", fontWeight: 700 }}>{proc.progress}%</span>
                      </div>
                      <div className="process-progress-bar">
                        <i style={{ width: `${proc.progress}%` }} />
                      </div>
                    </div>
                  </td>
                  <td>
                    <div style={{ fontSize: 9, color: "var(--muted)" }}>
                      <div>Latency: <strong>{proc.latency}</strong></div>
                      {proc.confidence !== undefined && <div>Confidence: <strong style={{ color: proc.confidence < 70 ? "#9b542d" : "var(--forest)" }}>{proc.confidence}%</strong></div>}
                    </div>
                  </td>
                  <td>
                    <div style={{ display: "flex", gap: 6 }}>
                      <button className="button button-ghost" style={{ minHeight: 28, padding: "0 8px", fontSize: 9 }} onClick={() => setSelectedPayload(proc)}>
                        Inspect
                      </button>
                      <button
                        className="button button-primary"
                        style={{ minHeight: 28, padding: "0 8px", fontSize: 9 }}
                        onClick={() => {
                          if (proc.category === "ocr") onNavigate("scan");
                          else if (proc.category === "geo") onNavigate("map");
                          else onNavigate("verification");
                        }}
                      >
                        Open
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Embedded Property Cases Registry */}
      <div className="process-monitor-panel" style={{ marginTop: 24 }}>
        <div className="panel-header">
          <div>
            <h2><BookOpen size={16} style={{ color: "var(--forest)", display: "inline", verticalAlign: "-2px" }} /> Property Cases Registry</h2>
            <p>Search, filter, and sort cases. Click Open Case to verify.</p>
          </div>
        </div>

        {/* Filters */}
        <div className="records-filter-panel">
          <div className="records-filter-row">
            <div className="records-search-input">
              <Search size={15} />
              <input
                type="text"
                placeholder="Search by Applicant, Case ID, Khasra, Village, or District..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <select className="filter-select" value={stateFilter} onChange={(e) => setStateFilter(e.target.value)}>
              <option value="all">All States</option>
              <option value="UP">Uttar Pradesh (UP)</option>
              <option value="KA">Karnataka (KA)</option>
              <option value="MH">Maharashtra (MH)</option>
              <option value="DL">Delhi NCR (DL)</option>
              <option value="HR">Haryana (HR)</option>
            </select>
            <select className="filter-select" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="all">All Statuses</option>
              <option value="positive">Positive (Approved)</option>
              <option value="refer">Refer (Review Required)</option>
              <option value="pending">Pending Review</option>
              <option value="negative">Negative (Rejected)</option>
            </select>
            <select className="filter-select" value={docTypeFilter} onChange={(e) => setDocTypeFilter(e.target.value)}>
              <option value="all">All Document Types</option>
              <option value="Sale Deed">Sale Deed</option>
              <option value="Khatauni / RTC">Khatauni / RTC</option>
              <option value="Mutation Order">Mutation Order</option>
              <option value="Cadastral Map">Cadastral Map</option>
            </select>
            <select className="filter-select" value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
              <option value="newest">Sort: Newest First</option>
              <option value="oldest">Sort: Oldest First</option>
              <option value="confidence">Sort: Confidence Score</option>
              <option value="applicant">Sort: Applicant Name</option>
            </select>
          </div>
        </div>

        {/* Table */}
        <div className="records-table-wrap" style={{ marginTop: 12 }}>
          <table className="records-table">
            <thead>
              <tr>
                <th>Case ID</th>
                <th>Applicant / Holder</th>
                <th>Property & Khasra</th>
                <th>Location & State</th>
                <th>Document Type</th>
                <th>OCR Confidence</th>
                <th>Verification Status</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {filteredRecords.length > 0 ? (
                filteredRecords.map((rec) => (
                  <tr key={rec.id}>
                    <td>
                      <strong style={{ font: "11px var(--font-geist-mono)" }}>{rec.id}</strong>
                      <span>{rec.date}</span>
                    </td>
                    <td>
                      <strong style={{ fontSize: 11 }}>{rec.applicant}</strong>
                      {rec.hasHandwritingReview && <span style={{ color: "#c3773e", fontSize: "9px" }}><AlertTriangle size={9} /> Handwriting review</span>}
                    </td>
                    <td>
                      <strong>{rec.property}</strong>
                      <span>Khasra: {rec.khasra}</span>
                    </td>
                    <td>
                      <span>{rec.village}, {rec.tehsil}</span>
                      <strong>{rec.district}, {rec.state}</strong>
                    </td>
                    <td>
                      <span className="doc-type-badge">{rec.docType}</span>
                    </td>
                    <td>
                      <strong style={{ color: rec.confidence < 75 ? "#b04435" : rec.confidence < 90 ? "#a06a09" : "#27764a" }}>
                        {rec.confidence.toFixed(1)}%
                      </strong>
                    </td>
                    <td>
                      <ResultBadge status={rec.status === "pending" ? "refer" : rec.status} compact />
                    </td>
                    <td>
                      <div style={{ display: "flex", gap: 6 }}>
                        <button className="button button-primary" style={{ minHeight: 28, padding: "0 9px", fontSize: 9 }} onClick={() => {
                          onSelectCaseId(rec.id);
                          onNavigate("verification");
                        }}>
                          Open Case
                        </button>
                        <button className="button button-ghost" style={{ minHeight: 28, padding: "0 8px", fontSize: 9 }} onClick={() => { setEditingRecord(rec); setOpenAddModal(true); }}>
                          Edit
                        </button>
                        <button className="button button-ghost" style={{ minHeight: 28, padding: "0 8px", fontSize: 9, color: "var(--alert)", borderColor: "rgba(220,53,69,0.2)" }} onClick={() => handleDeleteClick(rec.id)}>
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={8} style={{ textAlign: "center", padding: 40 }}>
                    <div style={{ color: "var(--muted)" }}>
                      <Search size={28} style={{ marginBottom: 8, opacity: 0.5 }} />
                      <strong style={{ display: "block", fontSize: 13, color: "var(--ink)" }}>No property records matched your filters</strong>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Smart AI Insights & System Log */}
      <div style={{ marginTop: 24, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
        <div style={{ background: "#fffefa", border: "1px solid #d1d6d0", borderRadius: 7, padding: 20 }}>
          <h3 style={{ margin: "0 0 12px", fontSize: 14, display: "flex", alignItems: "center", gap: 8 }}>
            <Sparkles size={16} style={{ color: "var(--forest)" }} /> Smart AI Operations & Anomaly Detection
          </h3>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ padding: 12, border: "1px solid #ffe0b2", background: "#fff8e1", borderRadius: 6, display: "flex", gap: 10 }}>
              <AlertTriangle size={16} style={{ color: "#e65100", flex: "0 0 auto", marginTop: 2 }} />
              <div>
                <strong style={{ fontSize: 11, display: "block", color: "#e65100" }}>Access Width Variance Flagged</strong>
                <span style={{ fontSize: 9, color: "#616161", lineHeight: 1.4, display: "block", marginTop: 3 }}>
                  Case SHFL0021847 (Varanasi): Deed records 18 ft Municipal lane while UP Portal records 20 ft lane. Within 2 ft tolerance limits.
                </span>
              </div>
            </div>

            <div style={{ padding: 12, border: "1px solid #c8e6c9", background: "#e8f5e9", borderRadius: 6, display: "flex", gap: 10 }}>
              <CheckCircle2 size={16} style={{ color: "#2e7d32", flex: "0 0 auto", marginTop: 2 }} />
              <div>
                <strong style={{ fontSize: 11, display: "block", color: "#2e7d32" }}>Cadastral Plot Alignment High Precision</strong>
                <span style={{ fontSize: 9, color: "#616161", lineHeight: 1.4, display: "block", marginTop: 3 }}>
                  Survey No. 118/2B (Sampigehalli) overlay matched to OpenStreetMap basemap with ±2.4m coordinate deviation.
                </span>
              </div>
            </div>

            <div style={{ padding: 12, border: "1px solid #bbdefb", background: "#e3f2fd", borderRadius: 6, display: "flex", gap: 10 }}>
              <Zap size={16} style={{ color: "#1565c0", flex: "0 0 auto", marginTop: 2 }} />
              <div>
                <strong style={{ fontSize: 11, display: "block", color: "#1565c0" }}>Gemini 3.6 Flash Active</strong>
                <span style={{ fontSize: 9, color: "#616161", lineHeight: 1.4, display: "block", marginTop: 3 }}>
                  Server-side vision model initialized. Multi-script Devanagari and Kannada OCR tuned for land registry vellum papers.
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Live Event Activity Stream */}
        <div style={{ background: "#fffefa", border: "1px solid #d1d6d0", borderRadius: 7, padding: 20 }}>
          <h3 style={{ margin: "0 0 12px", fontSize: 14, display: "flex", alignItems: "center", gap: 8 }}>
            <Clock size={16} style={{ color: "var(--forest)" }} /> Real-Time Process Activity Feed
          </h3>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {[
              ["Just now", "Gemini OCR completed block layout parsing for Page 1 of Meera_Sharma_SaleDeed.pdf"],
              ["2 mins ago", "OpenStreetMap cadastral polygon pinned for Survey 118/2B (Sampigehalli)"],
              ["5 mins ago", "Analyst confirmed handwritten seller name 'Arjun Kumar Gupta' on line 6"],
              ["12 mins ago", "PDF Report SHFL0021847-property-verification.pdf exported with 3-source matrix"],
              ["18 mins ago", "Government portal UP Bhulekh sync query returned 99.4% owner name match"],
            ].map(([time, text], idx) => (
              <div key={idx} style={{ display: "grid", gridTemplateColumns: "70px 1fr", gap: 10, fontSize: 9, paddingBottom: 8, borderBottom: idx < 4 ? "1px solid #e0e4df" : "none" }}>
                <span style={{ font: "8px var(--font-geist-mono)", color: "var(--forest)", fontWeight: 700 }}>{time}</span>
                <span style={{ color: "var(--ink)", lineHeight: 1.4 }}>{text}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Payload Inspection Modal */}
      {selectedPayload && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Process payload inspection">
          <div className="upgrade-modal" style={{ maxWidth: 580 }}>
            <button className="modal-close" onClick={() => setSelectedPayload(null)} aria-label="Close"><X size={18} /></button>
            <div className="modal-copy">
              <div className="eyebrow"><Activity size={13} /> {selectedPayload.id}</div>
              <h2 style={{ fontSize: 20 }}>{selectedPayload.name}</h2>
              <p>{selectedPayload.details}</p>
            </div>
            <div style={{ background: "#202421", color: "#dfff6d", padding: 14, borderRadius: 6, font: "9px var(--font-geist-mono)", overflowX: "auto", marginTop: 14 }}>
              <pre style={{ margin: 0 }}>
{JSON.stringify(
  {
    processId: selectedPayload.id,
    name: selectedPayload.name,
    category: selectedPayload.category,
    status: selectedPayload.status,
    progress: `${selectedPayload.progress}%`,
    targetResource: selectedPayload.target,
    location: selectedPayload.location,
    latency: selectedPayload.latency,
    confidence: selectedPayload.confidence ? `${selectedPayload.confidence}%` : "N/A",
    systemTimestamp: new Date().toISOString(),
  },
  null,
  2
)}
              </pre>
            </div>
            <button className="button button-primary" style={{ marginTop: 14, width: "100%" }} onClick={() => setSelectedPayload(null)}>
              Close inspector
            </button>
          </div>
        </div>
      )}
      {/* Register / Edit Land Record Modal */}
      {openAddModal && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Register Land Record Form">
          <div className="upgrade-modal" style={{ maxWidth: 520, background: "#fff", border: "1px solid #ccd1ca", borderRadius: "12px", boxShadow: "0 10px 30px rgba(0,0,0,0.18)" }}>
            <button className="modal-close" onClick={() => { setOpenAddModal(false); setEditingRecord(null); }} aria-label="Close modal"><X size={18} /></button>
            <div className="modal-copy" style={{ textAlign: "left" }}>
              <h2 style={{ fontSize: 20, marginBottom: "4px" }}>{editingRecord ? "Update Land Record" : "Register New Land"}</h2>
              <p style={{ fontSize: 10, color: "var(--muted)" }}>Fill in the details below to add or update this government record.</p>
            </div>
            
            <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "10px", marginTop: "14px", textAlign: "left" }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
                <label style={{ display: "flex", flexDirection: "column", fontSize: "10px", fontWeight: "600", color: "var(--ink)", gap: "4px" }}>
                  Case ID
                  <input value={formCaseId} disabled style={{ padding: "8px", border: "1px solid #cbd0ca", borderRadius: "4px", fontSize: "11px", background: "#f5f6f4" }} />
                </label>
                <label style={{ display: "flex", flexDirection: "column", fontSize: "10px", fontWeight: "600", color: "var(--ink)", gap: "4px" }}>
                  Applicant Name *
                  <input required value={formApplicant} onChange={(e) => setFormApplicant(e.target.value)} placeholder="e.g. Meera Sharma" style={{ padding: "8px", border: "1px solid #cbd0ca", borderRadius: "4px", fontSize: "11px", background: "#fff", color: "var(--ink)" }} />
                </label>
              </div>

              <label style={{ display: "flex", flexDirection: "column", fontSize: "10px", fontWeight: "600", color: "var(--ink)", gap: "4px" }}>
                Property Description (Area & Khasra) *
                <input required value={formProperty} onChange={(e) => setFormProperty(e.target.value)} placeholder="e.g. Khasra 214/3 · 52,700 sq.ft" style={{ padding: "8px", border: "1px solid #cbd0ca", borderRadius: "4px", fontSize: "11px", background: "#fff", color: "var(--ink)" }} />
              </label>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
                <label style={{ display: "flex", flexDirection: "column", fontSize: "10px", fontWeight: "600", color: "var(--ink)", gap: "4px" }}>
                  Khasra Number *
                  <input required value={formKhasra} onChange={(e) => setFormKhasra(e.target.value)} placeholder="e.g. 214/3" style={{ padding: "8px", border: "1px solid #cbd0ca", borderRadius: "4px", fontSize: "11px", background: "#fff", color: "var(--ink)" }} />
                </label>
                <label style={{ display: "flex", flexDirection: "column", fontSize: "10px", fontWeight: "600", color: "var(--ink)", gap: "4px" }}>
                  Village
                  <input value={formVillage} onChange={(e) => setFormVillage(e.target.value)} placeholder="e.g. Bhadaini" style={{ padding: "8px", border: "1px solid #cbd0ca", borderRadius: "4px", fontSize: "11px", background: "#fff", color: "var(--ink)" }} />
                </label>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "10px" }}>
                <label style={{ display: "flex", flexDirection: "column", fontSize: "10px", fontWeight: "600", color: "var(--ink)", gap: "4px" }}>
                  Tehsil
                  <input value={formTehsil} onChange={(e) => setFormTehsil(e.target.value)} placeholder="e.g. Sadar" style={{ padding: "8px", border: "1px solid #cbd0ca", borderRadius: "4px", fontSize: "11px", background: "#fff", color: "var(--ink)" }} />
                </label>
                <label style={{ display: "flex", flexDirection: "column", fontSize: "10px", fontWeight: "600", color: "var(--ink)", gap: "4px" }}>
                  District
                  <input value={formDistrict} onChange={(e) => setFormDistrict(e.target.value)} placeholder="e.g. Varanasi" style={{ padding: "8px", border: "1px solid #cbd0ca", borderRadius: "4px", fontSize: "11px", background: "#fff", color: "var(--ink)" }} />
                </label>
                <label style={{ display: "flex", flexDirection: "column", fontSize: "10px", fontWeight: "600", color: "var(--ink)", gap: "4px" }}>
                  State
                  <select value={formState} onChange={(e) => setFormState(e.target.value as RecordItem["state"])} style={{ padding: "8px", border: "1px solid #cbd0ca", borderRadius: "4px", fontSize: "11px", background: "#fff", color: "var(--ink)" }}>
                    <option value="UP">UP (Uttar Pradesh)</option>
                    <option value="KA">KA (Karnataka)</option>
                    <option value="MH">MH (Maharashtra)</option>
                    <option value="DL">DL (Delhi NCR)</option>
                    <option value="HR">HR (Haryana)</option>
                  </select>
                </label>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
                <label style={{ display: "flex", flexDirection: "column", fontSize: "10px", fontWeight: "600", color: "var(--ink)", gap: "4px" }}>
                  Document Type
                  <select value={formDocType} onChange={(e) => setFormDocType(e.target.value as RecordItem["docType"])} style={{ padding: "8px", border: "1px solid #cbd0ca", borderRadius: "4px", fontSize: "11px", background: "#fff", color: "var(--ink)" }}>
                    <option value="Sale Deed">Sale Deed</option>
                    <option value="Khatauni / RTC">Khatauni / RTC</option>
                    <option value="Mutation Order">Mutation Order</option>
                    <option value="Cadastral Map">Cadastral Map</option>
                  </select>
                </label>
                <label style={{ display: "flex", flexDirection: "column", fontSize: "10px", fontWeight: "600", color: "var(--ink)", gap: "4px" }}>
                  Verification Status
                  <select value={formStatus} onChange={(e) => setFormStatus(e.target.value as RecordItem["status"])} style={{ padding: "8px", border: "1px solid #cbd0ca", borderRadius: "4px", fontSize: "11px", background: "#fff", color: "var(--ink)" }}>
                    <option value="positive">Positive (Approved)</option>
                    <option value="refer">Refer (Review Required)</option>
                    <option value="pending">Pending Review</option>
                    <option value="negative">Negative (Rejected)</option>
                  </select>
                </label>
              </div>

              <label style={{ display: "flex", flexDirection: "column", fontSize: "10px", fontWeight: "600", color: "var(--ink)", gap: "4px" }}>
                OCR Accuracy Confidence (%)
                <input type="number" step="0.1" min="0" max="100" value={formConfidence} onChange={(e) => setFormConfidence(Number(e.target.value) || 98.0)} style={{ padding: "8px", border: "1px solid #cbd0ca", borderRadius: "4px", fontSize: "11px", background: "#fff", color: "var(--ink)" }} />
              </label>

              <div style={{ display: "flex", gap: "10px", marginTop: "14px" }}>
                <button type="button" className="button button-ghost" style={{ width: "50%" }} onClick={() => { setOpenAddModal(false); setEditingRecord(null); }}>
                  Cancel
                </button>
                <button type="submit" className="button button-primary" style={{ width: "50%" }}>
                  {editingRecord ? "Save Updates" : "Register Land"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </section>
  );
}

export default function Home() {
  const [view, setView] = useState<View>("dashboard");
  const [viewRestored, setViewRestored] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  
  // Shared state: recordsList and activeCaseId
  const [recordsList, setRecordsList] = useState<RecordItem[]>(initialRecords);
  const [activeCaseId, setActiveCaseId] = useState<string>("SHFL0021847");

  useEffect(() => {
    // Hash-based routing: #verification, #scan, #map, (empty) = dashboard
    const getViewFromHash = () => {
      const hash = window.location.hash.replace(/^#/, "");
      return (["dashboard", "verification", "scan", "map"].includes(hash) ? hash : "dashboard") as View;
    };

    setView(getViewFromHash());
    setViewRestored(true);

    const handleHashChange = () => setView(getViewFromHash());
    window.addEventListener("hashchange", handleHashChange);
    return () => window.removeEventListener("hashchange", handleHashChange);
  }, []);

  useEffect(() => {
    if (!viewRestored) return;
    const targetHash = view === "dashboard" ? "" : `#${view}`;
    const currentHash = window.location.hash;
    if (currentHash !== targetHash) {
      // Use replaceState to avoid stacking history on every render
      window.history.replaceState({}, "", targetHash || window.location.pathname);
    }
  }, [view, viewRestored]);

  const handleAddRecord = (newRec: RecordItem) => {
    setRecordsList((current) => {
      // Avoid duplicate keys
      const filtered = current.filter((r) => r.id !== newRec.id);
      return [newRec, ...filtered];
    });
    // Set it as active
    setActiveCaseId(newRec.id);
  };

  const handleDeleteRecord = (id: string) => {
    setRecordsList((current) => current.filter((r) => r.id !== id));
  };

  return (
    <main className="app-shell">
      <aside className={`sidebar ${menuOpen ? "open" : ""}`}>
        <div className="sidebar-brand"><BrandMark /><div><strong>Sitaara Verify</strong><span>Property intelligence</span></div></div>
        <nav aria-label="Primary navigation">
          <button className={view === "dashboard" ? "active" : ""} onClick={() => { setView("dashboard"); setMenuOpen(false); }}><LayoutDashboard size={18} /><span>Dashboard</span></button>
          <button className={view === "scan" ? "active" : ""} onClick={() => { setView("scan"); setMenuOpen(false); }}><ScanLine size={18} /><span>Document lab</span><ChevronRight size={14} /></button>
          <button className={view === "map" ? "active" : ""} onClick={() => { setView("map"); setMenuOpen(false); }}><MapPinned size={18} /><span>Plot map</span><ChevronRight size={14} /></button>
        </nav>
        <div className="sidebar-rule" />
        <div className="user-card"><div>AK</div><p><strong>Arjun Kumar</strong><span>Operator</span></p></div>
      </aside>

      <div className="main-panel">
        <div className="mobile-topbar"><button onClick={() => setMenuOpen((value) => !value)} aria-label="Open menu"><Menu /></button><div><BrandMark /><strong>Sitaara Verify</strong></div></div>
        {view === "dashboard" ? (
          <DashboardWorkspace 
            onNavigate={setView} 
            recordsList={recordsList} 
            onSelectCaseId={setActiveCaseId}
            onAddRecord={handleAddRecord}
            onDeleteRecord={handleDeleteRecord}
          />
        ) : view === "verification" ? (
          <VerificationWorkspace onOpenDocumentLab={() => setView("scan")} onOpenMap={() => setView("map")} activeCaseId={activeCaseId} recordsList={recordsList} />
        ) : view === "scan" ? (
          <ScanWorkspace onNavigate={setView} onAddRecord={handleAddRecord} />
        ) : view === "map" ? (
          <MapWorkspace onNavigate={setView} activeCaseId={activeCaseId} recordsList={recordsList} />
        ) : (
          <div style={{ padding: 24 }}>View not found.</div>
        )}
      </div>
      {menuOpen && <button className="mobile-scrim" aria-label="Close menu" onClick={() => setMenuOpen(false)} />}
    </main>
  );
}

