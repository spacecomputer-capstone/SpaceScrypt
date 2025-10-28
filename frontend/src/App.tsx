/// <reference types="vite/client" />
/// <reference types="web-bluetooth" />

import React, { useEffect, useRef, useState } from "react";

// ====== Config ======
const API = import.meta.env.VITE_API_BASE || "http://localhost:8787";
const SERVICE_UUID    = import.meta.env.VITE_SERVICE_UUID!;
const ID_CHAR_UUID    = import.meta.env.VITE_ID_CHAR_UUID!;
const SIGN_NONCE_UUID = import.meta.env.VITE_SIGN_NONCE_UUID!;
const SIGN_RESP_UUID  = import.meta.env.VITE_SIGN_RESP_UUID!;

// ====== Utils ======
function bytesToHex(b: ArrayBuffer | Uint8Array): string {
  const u8 = b instanceof Uint8Array ? b : new Uint8Array(b);
  return Array.from(u8).map(x => x.toString(16).padStart(2, "0")).join("");
}
function hexToBytes(hex: string): Uint8Array {
  if (!/^[0-9a-fA-F]*$/.test(hex) || hex.length % 2) throw new Error("bad hex");
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i*2, i*2+2), 16);
  return out;
}
function be64ToMs(buf: ArrayBuffer | Uint8Array): number {
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  if (u8.length !== 8) throw new Error("ts must be 8 bytes");
  let n = 0n;
  for (let i = 0; i < 8; i++) n = (n << 8n) | BigInt(u8[i]);
  return Number(n);
}

// ====== Types ======
type Conn = {
  idChar: BluetoothRemoteGATTCharacteristic;
  signNonceChar: BluetoothRemoteGATTCharacteristic;
  signRespChar: BluetoothRemoteGATTCharacteristic;
  device?: BluetoothDevice;
};

type FieldRowProps = {
  label: string;
  value: string;
  mono?: boolean;
  copy?: boolean;
};

// ====== UI Subcomponents ======
function IconCheck(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" {...props}>
      <path d="M20 6L9 17l-5-5"/>
    </svg>
  );
}
function IconX(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" {...props}>
      <path d="M18 6L6 18M6 6l12 12"/>
    </svg>
  );
}
function IconLink(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" {...props}>
      <path d="M10 13a5 5 0 007.07 0l1.41-1.41a5 5 0 00-7.07-7.07L10 5"/>
      <path d="M14 11a5 5 0 00-7.07 0L5.5 12.43a5 5 0 007.07 7.07L14 19"/>
    </svg>
  );
}
function Spinner({ className = "" }: { className?: string }) {
  return (
    <div className={`inline-block h-5 w-5 animate-spin rounded-full border-2 border-current border-t-transparent ${className}`} />
  );
}
function CopyButton({ text, className = "" }: { text: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        } catch {}
      }}
      className={`text-xs px-2 py-1 rounded-md border border-zinc-300/60 hover:bg-zinc-50 active:scale-[0.98] transition ${className}`}
    >
      {copied ? "Copied" : "Copy"}
    </button>
  );
}
function FieldRow({ label, value, mono, copy }: FieldRowProps) {
  return (
    <div className="grid grid-cols-3 gap-3 py-2 items-start">
      <div className="col-span-1 text-sm text-zinc-500 select-none">{label}</div>
      <div className="col-span-2 flex items-center gap-2">
        <div className={`min-h-[24px] break-all ${mono ? "font-mono text-[13px]" : ""}`}>{value || "—"}</div>
        {copy && value && <CopyButton text={value} />}
      </div>
    </div>
  );
}
function StatusPill({ state }: { state: "idle" | "ok" | "bad" | "loading" }) {
  const map: Record<string, string> = {
    idle: "bg-zinc-100 text-zinc-700",
    ok: "bg-emerald-100 text-emerald-700",
    bad: "bg-rose-100 text-rose-700",
    loading: "bg-indigo-100 text-indigo-700",
  };
  const label = state === "idle" ? "—" : state === "ok" ? "Verified" : state === "bad" ? "Not verified" : "Verifying";
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ${map[state]}`}>
      {state === "ok" && <IconCheck className="h-4 w-4" />}
      {state === "bad" && <IconX className="h-4 w-4" />}
      {state === "loading" && <Spinner className="h-4 w-4 border-[2px]" />}
      {label}
    </span>
  );
}

function Dot({ className = "" }: { className?: string }) {
  return <div className={`h-2 w-2 rounded-full ${className}`} />;
}

export default function App() {
  // ====== State ======
  const [supported, setSupported] = useState(false);
  const [deviceName, setDeviceName] = useState<string>("");
  const [beaconIdHex, setBeaconIdHex] = useState("");
  const [nonceHex, setNonceHex] = useState("");
  const [tsMs, setTsMs] = useState("");
  const [sigHex, setSigHex] = useState("");
  const [verified, setVerified] = useState<null | boolean>(null);
  const [err, setErr] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [verifying, setVerifying] = useState(false);

  const conn = useRef<Conn | null>(null);
  const notifyAttached = useRef(false);
  const nonceRef = useRef<string>("");

  useEffect(() => setSupported(!!navigator.bluetooth), []);

  // ====== Actions ======
  async function connectBeacon() {
    try {
      setErr(""); setVerified(null); setConnecting(true);
      if (!navigator.bluetooth) throw new Error("Web Bluetooth not supported in this browser");
      const device = await navigator.bluetooth.requestDevice({
        // acceptAllDevices: true,
        filters: [{ services: [SERVICE_UUID] }]
      });
      const server = await device.gatt!.connect();
      const svc = await server.getPrimaryService(SERVICE_UUID);
      const idChar = await svc.getCharacteristic(ID_CHAR_UUID);
      const signNonceChar = await svc.getCharacteristic(SIGN_NONCE_UUID);
      const signRespChar = await svc.getCharacteristic(SIGN_RESP_UUID);
      conn.current = { idChar, signNonceChar, signRespChar, device };
      setDeviceName(device.name || "Unknown device");

      // Read 8-byte Beacon ID
      const idVal = await idChar.readValue();
      setBeaconIdHex(bytesToHex(idVal.buffer).toLowerCase());
    } catch (e: any) {
      setErr(e?.message || String(e));
    } finally {
      setConnecting(false);
    }
  }

  async function disconnectBeacon() {
    try {
      const d = conn.current?.device;
      if (d?.gatt?.connected) d.gatt.disconnect();
      conn.current = null;
      notifyAttached.current = false;
      setDeviceName("");
      setBeaconIdHex("");
      setVerified(null);
      setNonceHex("");
      setTsMs("");
      setSigHex("");
      setErr("");
    } catch {}
  }

  async function verifyPresence() {
    try {
      setErr("");
      setVerified(null);
      setTsMs("");
      setSigHex("");
      setVerifying(true);
      if (!conn.current) throw new Error("Not connected to a beacon yet");
  
      const r = await fetch(`${API}/api/nonce`);
      if (!r.ok) throw new Error(`nonce failed: ${r.status}`);
      const { nonceHex } = await r.json();
      setNonceHex(nonceHex);
      nonceRef.current = nonceHex; // <-- critical
  
      if (!notifyAttached.current) {
        await conn.current.signRespChar.startNotifications();
        conn.current.signRespChar.addEventListener("characteristicvaluechanged", onNotify as any);
        notifyAttached.current = true;
      }
  
      await conn.current.signNonceChar.writeValueWithoutResponse(hexToBytes(nonceRef.current));
    } catch (e: any) {
      setErr(e?.message || String(e));
      setVerifying(false);
    }
  }  

  async function onNotify(ev: Event) {
    try {
      const char = ev.target as BluetoothRemoteGATTCharacteristic;
      const dv = char.value as DataView;
      const raw = new Uint8Array(dv.buffer);
      if (raw.length !== 72) { setErr(`Expected 72B, got ${raw.length}`); setVerifying(false); return; }
  
      const tsBytes = raw.slice(0, 8);
      const sigBytes = raw.slice(8);
      const ms = be64ToMs(tsBytes);
      const sig = bytesToHex(sigBytes);
  
      setTsMs(String(ms));
      setSigHex(sig);
  
      // Guard: make sure nonce is present and 32 hex chars
      if (!nonceRef.current || nonceRef.current.length !== 32) {
        setErr(`Nonce not ready (len=${nonceRef.current?.length || 0}) — press Verify again`);
        setVerifying(false);
        return;
      }
  
      const payload = {
        beaconIdHex,
        nonceHex: nonceRef.current, // <-- use ref, not state
        tsMs: String(ms),
        sigHex: sig,
      };
  
      // Debug: see exactly what’s sent (and copy the curl)
      console.groupCollapsed("[frontend] POST /api/verify");
      console.log("payload:", payload);
      console.log(
        "curl:",
        `curl -s -X POST ${API}/api/verify -H 'Content-Type: application/json' -d '${JSON.stringify(payload)}'`
      );
      console.groupEnd();
  
      const res = await fetch(`${API}/api/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      setVerified(!!json.ok);
      if (!json.ok && json.error) setErr(json.error);
    } catch (e: any) {
      setErr(e?.message || String(e));
    } finally {
      setVerifying(false);
    }
  }
  

  const verifiedState: "idle" | "ok" | "bad" | "loading" = verifying ? "loading" : verified === null ? "idle" : verified ? "ok" : "bad";
  const connected = !!beaconIdHex;

  // ====== Render ======
  return (
    <div className="relative min-h-screen h-dvh flex flex-col bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
      {/* Decorative gradient blobs */}
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -top-24 -left-24 h-80 w-80 rounded-full bg-indigo-400/20 blur-3xl" />
        <div className="absolute -bottom-24 -right-24 h-80 w-80 rounded-full bg-emerald-400/20 blur-3xl" />
      </div>

      {/* Header */}
      <header className="sticky top-0 z-10 backdrop-blur supports-[backdrop-filter]:bg-white/60 bg-white/80 dark:supports-[backdrop-filter]:bg-zinc-900/60 dark:bg-zinc-900/80 border-b border-zinc-200 dark:border-zinc-800">
        <div className="mx-auto max-w-none px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="h-9 w-9 rounded-xl bg-gradient-to-tr from-indigo-500 to-emerald-500 grid place-items-center text-white shadow">
              <IconLink className="h-5 w-5" />
            </div>
            <h1 className="text-lg font-semibold tracking-tight">Beacon Presence</h1>
          </div>
          <div className="flex items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
            <Dot className={supported ? "bg-emerald-500" : "bg-rose-500"} />
            {supported ? "Web Bluetooth available" : "Not supported"}
          </div>
        </div>
      </header>

      <main className="relative mx-auto max-w-none px-4 py-8 flex-1 flex items-stretch w-full">
        {/* Card fills remaining viewport height */}
        <div className="flex flex-col w-full flex-1 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/80 dark:bg-zinc-900/70 shadow-xl shadow-zinc-800/5 backdrop-blur overflow-hidden">
          <div className="border-b border-zinc-100 dark:border-zinc-800 bg-gradient-to-r from-indigo-50/70 via-sky-50/70 to-emerald-50/70 dark:from-indigo-500/10 dark:via-sky-500/10 dark:to-emerald-500/10 px-6 py-4 flex items-center justify-between">
            <div>
              <h2 className="text-base font-semibold">Presence Verification</h2>
              <p className="text-sm text-zinc-600 dark:text-zinc-400">Connect to a Bluetooth beacon and verify a signed nonce.</p>
            </div>
            <StatusPill state={verifiedState} />
          </div>

          <div className="p-6 space-y-6 flex-1 overflow-y-auto">
            {/* Actions */}
            <div className="flex flex-wrap items-center gap-3">
              {!connected ? (
                <button
                  onClick={connectBeacon}
                  disabled={!supported || connecting}
                  className="inline-flex items-center gap-2 rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-4 py-2 text-sm font-medium shadow-sm hover:bg-zinc-50 dark:hover:bg-zinc-800 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {connecting ? <Spinner /> : <IconLink className="h-5 w-5" />}
                  {connecting ? "Connecting…" : "Connect Beacon"}
                </button>
              ) : (
                <div className="flex items-center gap-3">
                  <button
                    onClick={verifyPresence}
                    disabled={verifying}
                    className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {verifying ? <Spinner className="border-white" /> : <IconCheck className="h-5 w-5" />}
                    {verifying ? "Verifying…" : "Verify Presence"}
                  </button>
                  <button
                    onClick={disconnectBeacon}
                    className="inline-flex items-center gap-2 rounded-xl border border-zinc-300 dark:border-zinc-700 px-4 py-2 text-sm font-medium hover:bg-zinc-50 dark:hover:bg-zinc-800"
                  >
                    Disconnect
                  </button>
                </div>
              )}

              <div className="text-xs text-zinc-500 dark:text-zinc-400 ml-auto">API: <span className="font-mono">{API}</span></div>
            </div>

            {/* Device status */}
            <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-gradient-to-br from-white/60 to-zinc-50/60 dark:from-zinc-900/50 dark:to-zinc-900/40 p-4 flex items-center gap-3">
              <Dot className={connected ? "bg-emerald-500" : "bg-zinc-300 dark:bg-zinc-700"} />
              <div className="text-sm">
                {connected ? (
                  <>
                    <span className="font-medium">Connected</span>
                    <span className="text-zinc-500 dark:text-zinc-400"> — {deviceName || "Beacon"}</span>
                  </>
                ) : (
                  <span className="text-zinc-600 dark:text-zinc-400">Not connected</span>
                )}
              </div>
            </div>

            {/* Data */}
            <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-4 bg-zinc-50/60 dark:bg-zinc-900/40">
              <FieldRow label="Beacon ID" value={beaconIdHex || ""} mono copy />
              <FieldRow label="Nonce" value={nonceHex || ""} mono copy />
              <FieldRow label="Timestamp (ms)" value={tsMs || ""} mono copy />
              <FieldRow label="Signature (hex)" value={sigHex || ""} mono copy />
              <div className="grid grid-cols-3 gap-3 py-2 items-start">
                <div className="col-span-1 text-sm text-zinc-500 select-none">Verified</div>
                <div className="col-span-2">
                  {verified === null ? (
                    <span className="text-zinc-600 dark:text-zinc-400">—</span>
                  ) : verified ? (
                    <div className="inline-flex items-center gap-2 text-emerald-700 dark:text-emerald-400">
                      <IconCheck className="h-5 w-5" />
                      <span className="font-medium">true</span>
                    </div>
                  ) : (
                    <div className="inline-flex items-center gap-2 text-rose-700 dark:text-rose-400">
                      <IconX className="h-5 w-5" />
                      <span className="font-medium">false</span>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Tips / Unsupported */}
            {!supported && (
              <div className="rounded-xl border border-rose-200 dark:border-rose-900/50 bg-rose-50 dark:bg-rose-950/40 p-4 text-rose-800 dark:text-rose-300">
                <div className="font-semibold">Your browser doesn’t support Web Bluetooth.</div>
                <p className="text-sm mt-1">Try Chrome on desktop with a secure (https://) origin.</p>
              </div>
            )}

            {err && (
              <div className="rounded-xl border border-rose-200 dark:border-rose-900/50 bg-rose-50 dark:bg-rose-950/40 p-4">
                <div className="font-semibold text-rose-800 dark:text-rose-300">Error</div>
                <p className="text-sm text-rose-700 dark:text-rose-400 mt-1">{err}</p>
              </div>
            )}
          </div>
        </div>
      </main>

      {/* Safe bottom inset for mobile */}
      <div className="h-[env(safe-area-inset-bottom)]" />
    </div>
  );
}
