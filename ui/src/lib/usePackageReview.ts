import { useEffect, useRef, useState } from "react";
import {
  type Bridge,
  type PackageReport,
  type Source,
  errorText,
} from "./bridge";

export function usePackageReview(
  bridge: Bridge,
  serial: string,
  source: Source | null,
) {
  const file = source?.file,
    url = source?.url;
  const key =
    serial && (file || url) ? JSON.stringify([serial, file, url]) : "";
  const [requested, setRequested] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<{
    key: string;
    report?: PackageReport;
    error?: string;
    percent?: number;
    received?: number;
  }>({ key: "" });
  const queue = useRef(Promise.resolve());
  useEffect(() => {
    if (!key || !bridge.available || (!file && requested !== key)) {
      setState({ key: "" });
      return;
    }
    let stale = false;
    setState({ key });
    // 宿主同时保留一份预检快照。快速切换目标时，只提交队列中仍有效的请求。
    queue.current = queue.current.then(async () => {
      if (stale) return;
      const off = bridge.subscribe((e) => {
        if (stale) return;
        if (e.event === "progress")
          setState((s) => ({ ...s, percent: e.value }));
        if (e.event === "downloadBytes")
          setState((s) => ({ ...s, received: e.value.received }));
      });
      try {
        const report = await bridge.request(
          "preflightPackage",
          file ? { serial, file } : { serial, url: url! },
        );
        if (
          !report?.token ||
          !["compatible", "incompatible", "unknown"].includes(
            report.compatibility,
          )
        )
          throw new Error("安装包预检未返回有效结果。");
        if (!stale) setState({ key, report });
      } catch (e) {
        if (!stale) setState({ key, error: errorText(e) });
      } finally {
        off();
      }
    });
    return () => {
      stale = true;
    };
  }, [bridge, serial, file, url, key, requested, attempt]);
  const current = key && state.key === key ? state : undefined;
  function retry() {
    setRequested(key);
    setAttempt((v) => v + 1);
  }
  return {
    report: current?.report,
    error: current?.error,
    pending: !!current && !current.report && !current.error,
    percent: current?.percent,
    received: current?.received,
    consume: () => setState({key,error:"此预检已用于安装。再次安装前请重新预检。"}),
    retry,
  };
}
