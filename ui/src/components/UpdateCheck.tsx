import { useEffect, useRef, useState } from "react";
import { RefreshCw, Download } from "lucide-react";
import { type Bridge, errorText } from "@/lib/bridge";
export function isNewRelease(candidate: string, current: string) {
  function parts(s: string) {
    const m = /^v?(\d+)\.(\d+)\.(\d+)(?:\+[\w.-]+)?$/.exec(s);
    return m?.slice(1, 4).map(Number);
  }
  const a = parts(candidate),
    b = parts(current);
  if (!a || !b) return false;
  const n = a.findIndex((part, i) => part !== b[i]);
  return n >= 0 && a[n] > b[n];
}
export function UpdateCheck({
  bridge,
  current,
}: {
  bridge: Bridge;
  current?: string | null;
}) {
  const [latest, setLatest] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  const flight = useRef(false);
  async function check(manual: boolean) {
    if (!current || flight.current) return;
    flight.current = true;
    setBusy(true);
    setMessage("");
    try {
      const r = await bridge.request("checkUpdate", {});
      if (isNewRelease(r.version, current)) setLatest(r.version);
      else if (manual) setMessage("当前已是最新版");
    } catch (e) {
      if (manual) setMessage(`检查失败：${errorText(e)}`);
    } finally {
      flight.current = false;
      setBusy(false);
    }
  }
  useEffect(() => {
    if (bridge.available && current) void check(false);
  }, [bridge, current]);
  return (
    <div className="footer-update">
      {latest ? (
        <>
          <span role="status" className="min-w-0 wrap-anywhere">发现新版本 {latest}</span>
          <button type="button" className="footer-action"
            onClick={() =>
              bridge
                .request("openReleases", {})
                .catch((e) => setMessage(errorText(e)))
            }
          >
            <Download size={16} aria-hidden />查看并下载
          </button>
        </>
      ) : (
        <button type="button" className="footer-action"
          disabled={!current || busy}
          onClick={() => check(true)}
        >
          <RefreshCw size={16} aria-hidden />{busy ? "检查更新中…" : "检查更新"}
        </button>
      )}
      {message && <span role="status" className="basis-full wrap-anywhere">{message}</span>}
    </div>
  );
}
