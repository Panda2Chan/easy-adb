import { useCallback, useEffect, useRef, useState } from "react";
import {
  Activity,
  MonitorSmartphone,
  Keyboard,
  Layers,
  Check,
  CircleAlert,
  FileBox,
  FolderOpen,
  Link2,
  LockKeyhole,
  PackageOpen,
  Upload,
} from "lucide-react";
import { Bridge, errorText, type Source } from "./lib/bridge";
import { online, stateText, useDevices } from "./lib/devices";
import { Button } from "./components/ui/button";
import { Input } from "./components/ui/input";
import { DevicePanel } from "./components/DevicePanel";
import { AppLibrary } from "./components/AppLibrary";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "./components/ui/tabs";
import { ApkPreflight } from "./components/ApkPreflight";
import { usePackageReview } from "./lib/usePackageReview";
import { DeviceText } from "./components/DeviceText";
import { diagnoseInstall } from "./lib/installDiagnosis";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "./components/ui/dialog";
import { Wireless } from "./components/Wireless";

type Task = {
  phase: "idle" | "running" | "success" | "error";
  stage: string;
  progress?: number;
  received?: number;
  total?: number | null;
  serial?: string;
  source?: string;
  requestKey?: string;
  downgradeTried?: boolean;
};
const basename = (path: string) => path.split(/[\\/]/).pop() || path;
function validUrl(text: string) {
  try {
    return (
      /^https?:\/\//i.test(text) &&
      ["http:", "https:"].includes(new URL(text).protocol)
    );
  } catch {
    return false;
  }
}

export function App({ bridge }: { bridge: Bridge }) {
  const { devices, refresh, scanning, scanError } = useDevices(bridge);
  const [serial, setSerial] = useState("");
  const [lastName, setLastName] = useState("");
  function lockTarget(id: string) {
    setSerial(id);
    setLastName(devices.find((d) => d.serial === id)?.name || id);
  }
  const device = devices.find((d) => d.serial === serial);
  const [mode, setMode] = useState<"file" | "url">("file");
  const [file, setFile] = useState(""),
    [url, setUrl] = useState("");
  const [sourceError, setSourceError] = useState(""),
    [picking, setPicking] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [task, setTask] = useState<Task>({ phase: "idle", stage: "等待安装" });
  const active = useRef<symbol | null>(null);
  const [cancelRequested, setCancelRequested] = useState(false),
    [cancelError, setCancelError] = useState("");
  const busy = task.phase === "running";
  const [view, setView] = useState("install");
  const [notice, setNotice] = useState("");
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!busy) return;
    const started = Date.now();
    setElapsed(0);
    const timer = setInterval(
      () => setElapsed(Math.floor((Date.now() - started) / 1000)),
      1000,
    );
    return () => clearInterval(timer);
  }, [busy]);
  const address = url.trim();
  const source: Source | null =
    mode === "file"
      ? file
        ? { file }
        : null
      : validUrl(address)
        ? { url: address }
        : null;
  const review = usePackageReview(
    bridge,
    online(device) && !scanError ? serial : "",
    source,
  );
  const ready =
    !!review.report &&
    review.report.compatibility !== "incompatible" &&
    bridge.available &&
    !busy &&
    !picking &&
    !scanError &&
    online(device) &&
    !!source;
  const targetHint = !serial
    ? "请选择目标设备"
    : !device
      ? "目标设备已断开，请重新连接或手动选择其他设备"
      : !online(device)
        ? stateText(device)
        : `已锁定 ${device.name || serial}`;
  const acceptFile = useCallback((path: string) => {
    if (active.current) return;
    setView("install");
    setDragging(false);
    setMode("file");
    if (!/\.(apk|apks|xapk)$/i.test(path)) {
      setFile("");
      setSourceError("请选择 APK、APKS 或 XAPK 安装包。");
      return;
    }
    setFile(path);
    setSourceError("");
  }, []);
  useEffect(
    () =>
      bridge.subscribe((event) => {
        if (event.event === "file") {
          acceptFile(event.value);
          return;
        }
        if (!active.current) return;
        if (event.event === "downloadBytes") {
          setTask((t) => ({
            ...t,
            received: event.value.received,
            total: event.value.total,
          }));
          return;
        }
        if (event.event === "progress")
          setTask((t) => ({
            ...t,
            progress: Math.max(0, Math.min(100, Math.round(event.value))),
          }));
        else
          setTask((t) => ({
            ...t,
            stage:
              (
                { downloading: "正在下载", installing: "正在安装" } as Record<
                  string,
                  string
                >
              )[event.value] ?? event.value,
            progress: undefined,
          }));
      }),
    [bridge, acceptFile],
  );
  async function pick() {
    if (busy || picking) return;
    setPicking(true);
    setSourceError("");
    try {
      const path = await bridge.request("pick", {});
      if (path !== null) acceptFile(path);
    } catch (err) {
      setSourceError(errorText(err));
    } finally {
      setPicking(false);
    }
  }
  function drop(event: React.DragEvent) {
    event.preventDefault();
    setDragging(false);
    if (busy || picking) return;
    const files = event.dataTransfer.files;
    if (files.length !== 1 || !/\.(apk|apks|xapk)$/i.test(files[0].name)) {
      setSourceError("每次请拖入一个 APK、APKS 或 XAPK 文件。");
      return;
    }
    setMode("file");
    setFile("");
    setSourceError("");
    // 路径仅接受宿主回传，Web 侧的 File.name 仅用于格式提示。
    try {
      bridge.drop(files[0]);
    } catch (err) {
      setSourceError(errorText(err));
    }
  }
  const [confirmKey, setConfirmKey] = useState<string | null>(null);
  const requestKey = JSON.stringify([serial, source]);
  const diagnosis =
    task.phase === "error" ? diagnoseInstall(task.stage) : undefined;
  async function install(downgrade = false) {
    if (!ready || !source || !review.report || active.current) return;
    if (
      downgrade &&
      (requestKey !== task.requestKey ||
        !diagnosis?.downgrade ||
        confirmKey !== requestKey)
    )
      return;
    setConfirmKey(null);
    active.current = Symbol("install");
    setCancelError("");
    setCancelRequested(false);
    setTask({
      phase: "running",
      stage: "正在准备安装",
      requestKey,
      downgradeTried: downgrade,
      serial,
      source: mode === "file" ? basename(file) : address,
    });
    try {
      await bridge.request("installPreflight", {
        serial,
        token: review.report.token,
        ...(downgrade ? { allowDowngrade: "true" as const } : {}),
      });
      review.consume();
      setTask((t) => ({
        ...t,
        phase: "success",
        stage: "安装完成",
        progress: 100,
      }));
    } catch (err) {
      setTask((t) => ({
        ...t,
        phase: "error",
        stage: errorText(err),
        progress: undefined,
      }));
    } finally {
      active.current = null;
      setCancelRequested(false);
    }
  }
  async function cancel() {
    const token = active.current;
    if (!token || cancelRequested) return;
    setCancelRequested(true);
    setCancelError("");
    try {
      await bridge.request("cancel", {});
    } catch (err) {
      if (active.current === token) {
        setCancelError(errorText(err));
        setCancelRequested(false);
      }
    }
  }
  function switchSource(next: typeof mode) {
    setMode(next);
    setSourceError("");
  }
  return (
    <main
      className="frame"
      onDragOver={(e) => e.preventDefault()}
      onDrop={drop}
    >
      <DevicePanel
        available={bridge.available}
        {...{ devices, serial, scanning, scanError, refresh, bridge }}
        select={(id) => {
          lockTarget(id);
          setNotice("");
        }}
        locked={busy}
      >
        <Wireless
          devices={devices}
          reliable={!scanError}
          bridge={bridge}
          disabled={!bridge.available || busy}
          refresh={refresh}
          onConnected={(id, name) => {
            lockTarget(id);
            setLastName(name);
            setNotice(`已连接到 ${name} · ${id}`);
          }}
        />
      </DevicePanel>
      <section className="desk">
        <div className="devicehead">
          <div className="target-icon" aria-hidden="true">
            <MonitorSmartphone />
          </div>
          <div>
            <div className="suptitle">当前设备</div>
            <h1>{device?.name || lastName || "选择设备"}</h1>
            <p className="endpoint">
              {device ? stateText(device) : serial ? "离线" : "等待连接"}{" "}
              {serial && ` / ${serial}`}
            </p>
          </div>
        </div>
        {notice && online(device) && (
          <p className="ok" role="status">
            {notice}
          </p>
        )}
        {!bridge.available && (
          <p className="notice">请在 Easy ADB 桌面应用中连接设备和安装应用。</p>
        )}
        <Tabs className="desk-tabs" value={view} onValueChange={setView}>
          <TabsList variant="line" aria-label="工作区">
            <TabsTrigger value="install">
              <PackageOpen />
              安装工作区
            </TabsTrigger>
            <TabsTrigger value="apps" disabled={busy}>
              <Layers />
              设备应用
            </TabsTrigger>
            <TabsTrigger value="text" disabled={busy}>
              <Keyboard />
              文本输入
            </TabsTrigger>
          </TabsList>
          <TabsContent value="text">
            {online(device) && !scanError ? (
              <DeviceText
                key={serial}
                bridge={bridge}
                name={device!.name || serial}
                serial={serial}
              />
            ) : (
              <p className="notice">请选择在线设备。</p>
            )}
          </TabsContent>
          <TabsContent value="install">
            <section className="installer">
              <div className="worktitle">
                <h2>安装 APK</h2>
              </div>
              <Tabs
                value={mode}
                onValueChange={(v) => switchSource(v as typeof mode)}
              >
                <TabsList aria-label="安装来源">
                  <TabsTrigger value="file" disabled={busy || picking}>
                    <FolderOpen />
                    本地 APK
                  </TabsTrigger>
                  <TabsTrigger value="url" disabled={busy || picking}>
                    <Link2 />
                    链接安装
                  </TabsTrigger>
                </TabsList>
                {mode === "file" ? (
                  <button
                    type="button"
                    aria-label="选择 APK 文件"
                    className={`dropzone ${dragging ? "over" : ""}`}
                    disabled={busy || picking || !bridge.available}
                    onClick={pick}
                    onDragOver={(e) => {
                      e.preventDefault();
                      if (!busy) setDragging(true);
                    }}
                    onDragLeave={() => setDragging(false)}
                  >
                    <span className="parcel">
                      {file ? <FileBox /> : <PackageOpen />}
                    </span>
                    <strong>{file ? basename(file) : "拖入安装包"}</strong>
                    <small title={file || undefined}>
                      {file || "或点击选择 APK、APKS、XAPK 文件"}
                    </small>
                  </button>
                ) : (
                  <div className="url-pane">
                    <label htmlFor="url">APK 下载地址</label>
                    <Input
                      id="url"
                      type="url"
                      spellCheck={false}
                      placeholder="https://…"
                      value={url}
                      disabled={busy}
                      onChange={(e) => setUrl(e.target.value)}
                    />
                    <p className="hint">
                      {address && !source
                        ? "请输入完整的 HTTP 或 HTTPS 地址。"
                        : "使用可直接下载安装包的 HTTP 或 HTTPS 链接。"}
                    </p>
                  </div>
                )}
              </Tabs>
              {review.pending && (
                <p role="status">
                  {mode === "url" ? "正在下载并预检安装包" : "正在预检安装包"}
                  {review.percent != null ? ` · ${review.percent}%` : ""}
                  {review.received != null
                    ? ` · ${(review.received / 1048576).toFixed(1)} MiB`
                    : ""}{" "}
                  <Button
                    variant="link"
                    onClick={() =>
                      bridge
                        .request("cancel", {})
                        .catch((e) => setSourceError(errorText(e)))
                    }
                  >
                    取消预检
                  </Button>
                </p>
              )}
              {review.error && (
                <p role="alert">
                  {review.error}{" "}
                  <Button variant="link" onClick={review.retry}>
                    重新预检
                  </Button>
                </p>
              )}
              {mode === "url" &&
                !!source &&
                online(device) &&
                !review.pending &&
                !review.report &&
                !review.error && (
                  <Button variant="outline" onClick={review.retry}>
                    下载并预检
                  </Button>
                )}
              {review.report && <ApkPreflight result={review.report} />}
              {sourceError && (
                <p className="error" role="alert">
                  {sourceError}
                </p>
              )}
              <div className="install-actions">
                <span title={serial}>
                  <LockKeyhole size={15} />
                  {targetHint}
                </span>
                <Button disabled={!ready} onClick={() => install()}>
                  <Upload />
                  <span className="button-label">
                    {serial ? `安装到 ${device?.name || lastName}` : "开始安装"}
                  </span>
                </Button>
              </div>
            </section>
            {task.phase !== "idle" && (
              <section className={`box activity ${task.phase}`}>
                <div className="section-head">
                  <h2>
                    <Activity />
                    任务状态
                  </h2>
                  {busy && (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={cancelRequested}
                      onClick={cancel}
                    >
                      {cancelRequested ? "已请求取消" : "取消安装"}
                    </Button>
                  )}
                </div>
                <div role="status" className="task-state">
                  {task.phase === "success" ? (
                    <Check />
                  ) : task.phase === "error" ? (
                    <CircleAlert />
                  ) : (
                    <i />
                  )}
                  <strong>{diagnosis?.title ?? task.stage}</strong>
                  {task.progress !== undefined && <code>{task.progress}%</code>}
                </div>
                {diagnosis && (
                  <div className="space-y-2">
                    <p>{diagnosis.advice}</p>
                    <details>
                      <summary>设备原始错误</summary>
                      <code>{task.stage}</code>
                    </details>
                    {diagnosis.downgrade &&
                      !task.downgradeTried &&
                      requestKey === task.requestKey && (
                        <Button
                          variant="outline"
                          disabled={!ready}
                          onClick={() => setConfirmKey(requestKey)}
                        >
                          尝试降级安装
                        </Button>
                      )}
                  </div>
                )}
                <Dialog
                  open={!!confirmKey && confirmKey === requestKey && ready}
                  onOpenChange={(open) => {
                    if (!open) setConfirmKey(null);
                  }}
                >
                  <DialogContent>
                    <DialogTitle>
                      尝试在 {device?.name || serial} 上降级？
                    </DialogTitle>
                    <DialogDescription>
                      将使用当前选择的安装包。旧版可能无法读取新版保存的数据。Android
                      通常只允许调试版应用保留数据降级。
                    </DialogDescription>
                    <Button
                      variant="outline"
                      onClick={() => setConfirmKey(null)}
                    >
                      取消
                    </Button>
                    <Button onClick={() => install(true)}>确认尝试降级</Button>
                  </DialogContent>
                </Dialog>
                {task.serial && (
                  <p className="task-info">
                    {task.serial} · {task.source}
                  </p>
                )}
                {busy && (
                  <>
                    <progress
                      aria-label="安装进度"
                      value={task.progress}
                      max={100}
                    />
                    <small>
                      {task.stage === "正在下载" && task.received != null
                        ? `已下载 ${(task.received / 1048576).toFixed(1)} MB${task.total ? ` / ${(task.total / 1048576).toFixed(1)} MB` : ""} · `
                        : ""}
                      已用 {elapsed} 秒
                    </small>
                  </>
                )}
                {busy && cancelError && (
                  <p className="error" role="alert">
                    取消请求失败：{cancelError}
                  </p>
                )}
                {task.phase === "success" &&
                  online(device) &&
                  device?.serial === task.serial && (
                    <Button variant="link" onClick={() => setView("apps")}>
                      查看设备应用
                    </Button>
                  )}
              </section>
            )}
          </TabsContent>
          <TabsContent value="apps">
            {online(device) && !scanError ? (
              <AppLibrary
                key={serial}
                bridge={bridge}
                serial={serial}
                deviceName={device!.name || serial}
              />
            ) : (
              <p className="notice">请先选择在线设备，再查看已安装的应用。</p>
            )}
          </TabsContent>
        </Tabs>
      </section>
    </main>
  );
}
