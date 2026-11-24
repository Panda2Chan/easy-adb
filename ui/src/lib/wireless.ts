import { useEffect, useState } from "react";
import { type Bridge, errorText } from "./bridge";

type Entry = { endpoint: string; name: string };
type Recent = Entry & { serviceName?: string };
export type Service = Entry & { kind: "connect" | "pair" };
const historyKey = "easy-adb.wireless.history.v1";
const limit = 5;

export function validEndpoint(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const port = /^(?:\[[\da-fA-F:.]+\]|[\w.-]+):(\d{1,5})$/.exec(value)?.[1];
  return !!port && Number(port) >= 1 && Number(port) <= 65535;
}

function isEntry(value: unknown): value is Entry {
  return (
    typeof value === "object" &&
    value !== null &&
    "endpoint" in value &&
    validEndpoint(value.endpoint) &&
    "name" in value &&
    typeof value.name === "string"
  );
}

export function useDiscovery(bridge: Bridge, open: boolean) {
  const [services, setServices] = useState<Service[]>([]);
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!open) return;
    let active = true;
    setLoading(true);
    setServices([]);
    setStatus("正在查找无线调试服务…");
    bridge
      .request("discoverDevices", {})
      .then((rows) => {
        if (!active) return;
        if (!Array.isArray(rows)) throw new Error("宿主返回的服务列表无效");
        const unique = new Map<string, Service>();
        for (const row of rows) {
          if (
            !isEntry(row) ||
            !("kind" in row) ||
            (row.kind !== "connect" && row.kind !== "pair")
          )
            continue;
          unique.set(`${row.kind}:${row.endpoint.toLowerCase()}`, {
            name: row.name,
            endpoint: row.endpoint,
            kind: row.kind,
          });
        }
        setServices([...unique.values()]);
        setStatus(
          unique.size ? "" : "未发现无线调试服务，可手动输入设备地址。",
        );
      })
      .catch((err) => {
        if (active)
          setStatus(`无法发现设备，可手动输入地址。${errorText(err)}`);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [open, bridge, revision]);
  return { services, status, loading, reload: () => setRevision((n) => n + 1) };
}

function loadHistory(): { entries: Recent[]; temporary: boolean } {
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(historyKey);
  } catch {
    return { entries: [], temporary: true };
  }
  try {
    const data: unknown = JSON.parse(raw ?? "[]");
    const entries = Array.isArray(data)
      ? data
          .filter(isEntry)
          .slice(0, limit)
          .map((row) => ({
            endpoint: row.endpoint,
            name: row.name,
            serviceName:
              "serviceName" in row && typeof row.serviceName === "string"
                ? row.serviceName
                : undefined,
          }))
      : [];
    return { entries, temporary: false };
  } catch {
    return { entries: [], temporary: false };
  }
}

export function useWirelessHistory() {
  const [history, setHistory] = useState(loadHistory);
  function save(entries: Recent[]) {
    // file origin 或配额限制可能使读取、写入分别失败。
    try {
      if (entries.length)
        window.localStorage.setItem(historyKey, JSON.stringify(entries));
      else window.localStorage.removeItem(historyKey);
      setHistory({ entries, temporary: false });
    } catch {
      setHistory({ entries, temporary: true });
    }
  }
  const without = (endpoint: string) =>
    history.entries.filter(
      (item) => item.endpoint.toLowerCase() !== endpoint.toLowerCase(),
    );
  return {
    ...history,
    remember: (entry: Recent) =>
      save(
        [
          entry,
          ...without(entry.endpoint).filter(
            (old) =>
              !(
                entry.serviceName &&
                old.serviceName === entry.serviceName &&
                hostOf(old.endpoint) === hostOf(entry.endpoint)
              ),
          ),
        ].slice(0, limit),
      ),
    forget: (endpoint: string) => save(without(endpoint)),
  };
}

export const hostOf = (endpoint: string) =>
  endpoint.slice(0, endpoint.lastIndexOf(":")).toLowerCase();

// adb devices 也可能用 mDNS 服务实例名作为序列号。
export function serviceMatches(service: Service, serial: string) {
  const suffix = "._adb-tls-connect._tcp";
  const normalized = (value: string) =>
    value.toLowerCase().replace(/\.(?:local\.)?$/, "");
  const name = normalized(service.name);
  return (
    service.kind === "connect" &&
    (service.endpoint.toLowerCase() === serial.toLowerCase() ||
      normalized(serial) === (name.endsWith(suffix) ? name : name + suffix))
  );
}

export function reconnectAddress(row: Recent, services: Service[]) {
  if (!row.serviceName) return row.endpoint;
  const candidates = services.filter(
    (s) =>
      s.kind === "connect" &&
      s.name === row.serviceName &&
      hostOf(s.endpoint) === hostOf(row.endpoint),
  );
  return candidates.length === 1 ? candidates[0].endpoint : row.endpoint;
}
