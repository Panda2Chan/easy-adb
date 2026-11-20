import { useCallback, useEffect, useRef, useState } from "react";
import {
  Activity,
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
import { Wireless } from "./components/Wireless";

type Task = {
  phase: "idle" | "running" | "success" | "error";
  stage: string;
  progress?: number;
  received?: number;
  total?: number | null;
  serial?: string;
  source?: string;
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
  const ready =
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
    if (!/\.apk$/i.test(path)) {
      setFile("");
      setSourceError("请选择 APK 格式的安装包。");
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
    if (files.length !== 1 || !/\.apk$/i.test(files[0].name)) {
      setSourceError("每次请拖入一个 APK 文件。");
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
  async function install() {
    if (!ready || !source || active.current) return;
    active.current = Symbol("install");
    setCancelError("");
    setCancelRequested(false);
    setTask({
      phase: "running",
      stage: "正在准备安装",
      serial,
      source: mode === "file" ? basename(file) : address,
    });
    try {
      await bridge.request("install", { serial, ...source });
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
          <div className="screen" aria-hidden="true">
            <div className="sky">
              <i />
              <b />
            </div>
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
          </TabsList>
          <TabsContent value="install">
            <section className="installer">
              <div className="worktitle">
                <h2>安装 APK</h2>
                <small>
                  {device
                    ? `目标 · ${device.name || serial}`
                    : "请选择目标设备"}
                </small>
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
                    <strong>
                      {file ? basename(file) : "将 APK 文件拖到这里"}
                    </strong>
                    <small title={file || undefined}>
                      {file || "或点击选择本地安装包"}
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
                <Button disabled={!ready} onClick={install}>
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
                  <strong>{task.stage}</strong>
                  {task.progress !== undefined && <code>{task.progress}%</code>}
                </div>
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
