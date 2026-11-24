import type { PackageReport } from "../lib/bridge";

const compatibilityStates = {
  compatible: { label: "设备兼容", style: "bg-accent text-accent-foreground" },
  unknown: { label: "兼容性待确认", style: "bg-muted text-muted-foreground" },
  incompatible: { label: "设备不兼容", style: "bg-destructive/10 text-destructive" },
};

export function ApkPreflight({ result }: { result: PackageReport }) {
  const status = compatibilityStates[result.compatibility];
  return (
    <section aria-label="安装包预检" className="grid min-w-0 gap-3 rounded-md border border-border bg-card p-4 font-sans text-sm text-foreground wrap-anywhere">
      <div className="flex items-center gap-3">
        {result.iconDataUrl?.startsWith("data:image/png;base64,") && (
          <img src={result.iconDataUrl} alt="" width={40} height={40} className="shrink-0" />
        )}
        <div className="min-w-0">
          <h3 className="text-xl leading-6 font-semibold">{result.label ?? result.packageName}</h3>
          <div className="text-xs text-muted-foreground">{result.packageName}</div>
        </div>
      </div>
      <div className="grid gap-2">
        <div>{result.format.toUpperCase()} · 版本 {result.versionName ?? "未知"}（{result.versionCode ?? "未知"}）</div>
        <div>最低 API {result.minSdk ?? "未知"} · ABI {result.abis === null ? "未知" : result.abis.join("、") || "无原生 ABI 限制"}</div>
      </div>
      <div role="status" className={`rounded-md px-3 py-2 ${status.style}`}>
        {status.label}{result.reasons.length > 0 && ` · ${result.reasons.join("；")}`}
      </div>
      {result.format !== "apk" && (
        <details>
          <summary className="cursor-pointer rounded-sm focus-visible:outline-ring">已选 {result.selectedSplits.length} 个 APK</summary>
          <ul className="mt-2 grid gap-2 ps-4 text-xs text-muted-foreground">
            {result.selectedSplits.map(name => <li key={name}>{name}</li>)}
          </ul>
        </details>
      )}
    </section>
  );
}
