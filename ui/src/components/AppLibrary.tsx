import { useCallback, useEffect, useRef, useState } from "react";
import {
  ChevronRight,
  Package,
  Search,
  ShieldCheck,
  Smartphone,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { type Bridge, type InstalledApp, errorText } from "@/lib/bridge";

type Props = { bridge: Bridge; serial: string; deviceName: string };
type ReadState<T> =
  | { phase: "loading" }
  | { phase: "error"; message: string }
  | { phase: "ready"; value: T };

function useHostRead<T>(read: () => Promise<T>) {
  const [state, setState] = useState<ReadState<T>>({ phase: "loading" });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    read().then(
      (value) => {
        if (active) setState({ phase: "ready", value });
      },
      (err) => {
        if (active) setState({ phase: "error", message: errorText(err) });
      },
    );
    return () => {
      active = false;
    };
  }, [read, attempt]);
  function reload() {
    setState({ phase: "loading" });
    setAttempt((n) => n + 1);
  }
  return { state, reload };
}

function Retry({ message, retry }: { message: string; retry: () => void }) {
  return (
    <div className="space-y-3">
      <p role="alert" className="break-words text-destructive">
        {message}
      </p>
      <Button type="button" variant="outline" size="sm" onClick={retry}>
        重试
      </Button>
    </div>
  );
}

export function AppLibrary(props: Props) {
  const { serial, deviceName } = props;
  return (
    <section
      aria-label="应用库"
      className="mx-auto w-full max-w-5xl space-y-6 text-sm text-foreground"
    >
      <div className="space-y-1">
        <h2 className="text-xl leading-6 font-semibold">应用库</h2>
        <p className="flex items-center gap-2 break-all text-xs text-muted-foreground">
          <Smartphone size={16} aria-hidden />
          {serial ? deviceName || serial : "请选择目标设备"}
        </p>
      </div>
      {/* 按序列号重建列表和弹窗，迟到的回执只属于原设备。 */}
      {serial && <DeviceApps key={serial} {...props} />}
    </section>
  );
}

function DeviceApps({ bridge, serial, deviceName }: Props) {
  const list = useHostRead(
    useCallback(() => bridge.request("listApps", { serial }), [bridge, serial]),
  );
  const [showSystem, setShowSystem] = useState(false);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<InstalledApp | null>(null);
  const [notice, setNotice] = useState("");
  const search = useRef<HTMLInputElement>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const apps = list.state.phase === "ready" ? list.state.value : [];
  const term = query.trim().toLowerCase();
  const visible = apps.filter(
    (app) =>
      (showSystem || !app.isSystem) &&
      app.packageName.toLowerCase().includes(term),
  );

  return (
    <>
      <div className="overflow-hidden rounded-xl border border-border bg-background">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-4">
          <h3 className="mr-auto text-sm font-semibold">
            已安装应用{" "}
            {list.state.phase === "ready" && (
              <span className="ml-1 text-xs font-medium tabular-nums text-muted-foreground">
                {apps.length}
              </span>
            )}
          </h3>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="size-4 accent-primary"
              checked={showSystem}
              onChange={(event) => setShowSystem(event.target.checked)}
            />
            显示系统应用
          </label>
          <div className="relative w-full sm:w-64">
            <Search
              size={16}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              ref={search}
              type="search"
              aria-label="搜索包名"
              placeholder="搜索包名"
              className="border-border bg-background pl-9 text-sm"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
        </div>
        {visible.length > 0 ? (
          <ul className="divide-y divide-border">
            {visible.map((app) => (
              <li key={app.packageName}>
                <button
                  type="button"
                  className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-muted/50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary"
                  onClick={(event) => {
                    trigger.current = event.currentTarget;
                    setNotice("");
                    setSelected(app);
                  }}
                >
                  <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-muted text-primary">
                    <Package size={20} aria-hidden />
                  </span>
                  <span
                    className="min-w-0 flex-1 truncate tabular-nums text-sm"
                    title={app.packageName}
                  >
                    {app.packageName}
                  </span>
                  {app.isSystem && (
                    <span className="flex items-center gap-1 text-xs text-muted-foreground">
                      <ShieldCheck size={14} aria-hidden />
                      系统
                    </span>
                  )}
                  <ChevronRight
                    size={16}
                    className="shrink-0 text-muted-foreground"
                    aria-hidden
                  />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <div className="space-y-3 px-4 py-6 text-center text-sm">
            {list.state.phase === "loading" ? (
              <p role="status">正在读取应用列表…</p>
            ) : list.state.phase === "error" ? (
              <Retry message={list.state.message} retry={list.reload} />
            ) : apps.length === 0 ? (
              <p>设备上没有已安装应用</p>
            ) : (
              <>
                <p>
                  {term
                    ? "没有找到匹配的应用"
                    : "没有用户安装的应用，可勾选显示系统应用。"}
                </p>
                <Button
                  variant="outline"
                  onClick={() => {
                    setQuery("");
                    search.current?.focus();
                  }}
                >
                  清空搜索
                </Button>
              </>
            )}
          </div>
        )}
      </div>
      {notice && (
        <p role="status" className="break-all text-xs text-muted-foreground">
          {notice}
        </p>
      )}
      {selected && (
        <AppDetails
          key={selected.packageName}
          {...{ bridge, serial, deviceName }}
          app={selected}
          onClose={() => setSelected(null)}
          restoreFocus={() =>
            (trigger.current?.isConnected
              ? trigger.current
              : search.current
            )?.focus()
          }
          onRemoved={() => {
            setSelected(null);
            setNotice(`已卸载 ${selected.packageName}`);
            list.reload();
          }}
        />
      )}
    </>
  );
}

function sizeText(bytes: number | null) {
  if (bytes == null || !Number.isFinite(bytes) || bytes < 0) return "未知";
  const units = ["B", "KiB", "MiB", "GiB"];
  const index = Math.min(
    units.length - 1,
    Math.floor(Math.log2(Math.max(1, bytes)) / 10),
  );
  return `${Number((bytes / 1024 ** index).toFixed(1))} ${units[index]}`;
}

function AppDetails({
  bridge,
  serial,
  deviceName,
  app,
  onClose,
  onRemoved,
  restoreFocus,
}: Props & {
  app: InstalledApp;
  onClose: () => void;
  onRemoved: () => void;
  restoreFocus: () => void;
}) {
  const { packageName } = app;
  const info = useHostRead(
    useCallback(
      () => bridge.request("appInfo", { serial, packageName }),
      [bridge, serial, packageName],
    ),
  );
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef(false);
  async function uninstall() {
    if (app.isSystem !== false || !confirming || pending.current) return;
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      await bridge.request("uninstallApp", { serial, packageName });
      onRemoved();
    } catch (err) {
      setError(errorText(err));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !pending.current) onClose();
      }}
    >
      <DialogContent
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          restoreFocus();
        }}
      >
        <DialogHeader>
          <DialogTitle className="break-all pr-8">
            {confirming ? "确认卸载应用？" : packageName}
          </DialogTitle>
          <DialogDescription className="break-all">
            {confirming
              ? `将从 ${deviceName || serial}（${serial}）卸载 ${packageName}，其应用数据也可能被删除。`
              : app.isSystem
                ? "系统应用"
                : "用户应用"}
          </DialogDescription>
        </DialogHeader>
        {confirming ? (
          <>
            {error && (
              <p role="alert" className="break-words text-sm text-destructive">
                {error}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <Button
                autoFocus
                variant="outline"
                disabled={busy}
                onClick={() => {
                  setConfirming(false);
                  setError("");
                }}
              >
                取消
              </Button>
              <Button variant="destructive" disabled={busy} onClick={uninstall}>
                {busy ? "正在卸载…" : "确认卸载"}
              </Button>
            </div>
          </>
        ) : (
          <>
            {info.state.phase === "loading" ? (
              <p role="status">正在读取应用详情…</p>
            ) : info.state.phase === "error" ? (
              <Retry message={info.state.message} retry={info.reload} />
            ) : (
              <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-3 border-y border-border py-4 text-sm">
                <dt className="text-muted-foreground">版本</dt>
                <dd className="break-all text-right tabular-nums">
                  {info.state.value.versionName || "未知"}
                </dd>
                <dt className="text-muted-foreground">安装包大小</dt>
                <dd className="text-right tabular-nums">
                  {sizeText(info.state.value.sizeBytes)}
                </dd>
              </dl>
            )}
            {app.isSystem !== false ? (
              <p className="flex items-center gap-2 text-xs text-muted-foreground">
                <ShieldCheck size={16} aria-hidden />
                系统应用受保护，无法卸载。
              </p>
            ) : (
              <Button
                variant="outline"
                className="justify-self-end text-destructive hover:bg-destructive/10 hover:text-destructive"
                onClick={() => setConfirming(true)}
              >
                <Trash2 aria-hidden />
                卸载应用
              </Button>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
