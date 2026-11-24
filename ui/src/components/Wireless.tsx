import { useEffect, useState } from "react";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "./ui/dialog";
import { Wifi, X } from "lucide-react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { online } from "@/lib/devices";
import { type Bridge, type Device, errorText } from "@/lib/bridge";

import {
  reconnectAddress,
  hostOf,
  serviceMatches,
  useDiscovery,
  useWirelessHistory,
  validEndpoint,
} from "@/lib/wireless";

type Pending = { endpoint: string; mode: "connect" | "pair"; before: Device[] };

export function Wireless({
  bridge,
  disabled,
  refresh,
  devices,
  reliable,
  onConnected,
}: {
  devices: Device[];
  reliable: boolean;
  onConnected: (serial: string, name: string) => void;
  bridge: Bridge;
  disabled: boolean;
  refresh: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"connect" | "pair">("connect");
  const [endpoint, setEndpoint] = useState(""),
    [code, setCode] = useState("");
  const [message, setMessage] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const discovery = useDiscovery(bridge, open);
  const history = useWirelessHistory();
  const [pending, setPending] = useState<Pending | null>(null);
  const pairedHost = pending?.mode === "pair" ? hostOf(pending.endpoint) : "";
  const [customPort, setCustomPort] = useState("");
  const [showPort, setShowPort] = useState(false);

  useEffect(() => {
    if (!open || !reliable || !pending || devices === pending.before) return;
    const matches = devices.flatMap((device) => {
      if (!online(device)) return [];
      const service = discovery.services.find((row) =>
        serviceMatches(row, device.serial),
      );
      const address = validEndpoint(device.serial)
        ? device.serial
        : service?.endpoint;
      if (!address) return [];
      const exact = address.toLowerCase() === pending.endpoint.toLowerCase();
      if (pending.mode === "connect") return exact ? [{ device, address }] : [];
      // 配对端口不可重连；只认同主机新上线且可唯一确认的连接端口。
      const alreadyOnline = pending.before.some(
        (d) => d.serial === device.serial && online(d),
      );
      return !exact && !alreadyOnline && hostOf(address) === pairedHost
        ? [{ device, address }]
        : [];
    });
    if (
      !matches.length ||
      new Set(matches.map((m) => m.address.toLowerCase())).size !== 1
    )
      return;
    const { device, address } = matches[0];
    const name = device.name || device.serial;
    const service = discovery.services.find(
      (s) =>
        s.kind === "connect" &&
        s.endpoint.toLowerCase() === address.toLowerCase(),
    );
    history.remember({ endpoint: address, name, serviceName: service?.name });
    setPending(null);
    setOpen(false);
    onConnected(device.serial, name);
  }, [
    devices,
    pending,
    pairedHost,
    discovery.services,
    history,
    open,
    reliable,
    onConnected,
  ]);

  const pair = mode === "pair";
  function switchMode(value: typeof mode) {
    setPending(null);
    setMode(value);
    setEndpoint("");
    setCustomPort("");
    setShowPort(false);
    setCode("");
    setError("");
    setMessage("");
  }
  async function run(action: typeof mode, address: string) {
    if (busy) return;
    if (!validEndpoint(address))
      return setError("请输入完整的设备地址和端口。");
    if (
      action === "connect" &&
      discovery.services.some(
        (s) =>
          s.kind === "pair" &&
          s.endpoint.toLowerCase() === address.toLowerCase(),
      ) &&
      !discovery.services.some(
        (s) =>
          s.kind === "connect" &&
          s.endpoint.toLowerCase() === address.toLowerCase(),
      )
    )
      return setError("这是配对端口，请使用配对码或选择连接端口。");
    if (action === "pair" && !/^\d{6}$/.test(code))
      return setError("请输入设备显示的六位配对码。");
    setPending(null);
    setError("");
    setMessage("");
    setBusy(true);
    try {
      if (action === "pair") {
        await bridge.request("pair", { endpoint: address, code });
        switchMode("connect");
        discovery.reload();
      } else {
        await bridge.request("connect", { endpoint: address });
        setMessage("设备已接受连接，正在确认在线状态。请在设备上允许调试。");
      }
      setPending({ mode: action, endpoint: address, before: devices });
      refresh();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }
  function submit(event: React.FormEvent) {
    event.preventDefault();
    const host = endpoint.trim();
    void run(
      mode,
      pair || /:\d+$/.test(host) ? host : `${host}:${customPort || "5555"}`,
    );
  }
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!busy) {
          setOpen(next);
          switchMode("connect");
        }
      }}
    >
      <DialogTrigger asChild>
        <Button
          className="railbtn"
          variant="ghost"
          disabled={disabled}
          aria-label="无线连接"
        >
          <Wifi />
          Wi-Fi 连接
        </Button>
      </DialogTrigger>
      <DialogContent showCloseButton={false} className="max-w-[min(26.25rem,calc(100%-2rem))] sm:max-w-[26.25rem]">
        <DialogHeader>
          <div className="flex items-center justify-between gap-3">
            <DialogTitle>无线连接</DialogTitle>
            <DialogClose asChild>
              <Button variant="ghost" size="icon-sm" aria-label="关闭" disabled={busy} className="text-muted-foreground hover:bg-muted hover:text-foreground">
                <X />
              </Button>
            </DialogClose>
          </div>
          <DialogDescription>
            将电脑与设备接入同一网络，并在设备上开启网络或无线调试。
          </DialogDescription>
        </DialogHeader>
        <section aria-label="附近的无线调试服务" className="grid gap-2 border-b border-border pb-4">
          <div className="flex items-center justify-between gap-2">
            <strong className="font-semibold">附近设备</strong>
            <Button
              variant="ghost"
              size="sm"
              disabled={discovery.loading || busy}
              onClick={discovery.reload}
            >
              重新发现
            </Button>
          </div>
          {discovery.status && (
            <p className="text-xs leading-4 text-muted-foreground" role="status">
              {discovery.status}
            </p>
          )}
          {discovery.services.map((row) => (
            <div
              key={`${row.kind}:${row.endpoint}`}
              className="flex items-center justify-between gap-2"
            >
              <span className="min-w-0 break-all">
                {row.name}
                <small className="block text-xs leading-4 text-muted-foreground">{row.endpoint}</small>
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={busy}
                aria-label={`${row.kind === "pair" ? "配对" : "连接"} ${row.endpoint}`}
                onClick={() => {
                  switchMode(row.kind);
                  setEndpoint(row.endpoint);
                  if (row.kind === "connect")
                    void run("connect", row.endpoint);
                }}
              >
                {row.kind === "pair" ? "输入配对码" : "连接"}
              </Button>
            </div>
          ))}
        </section>
        {history.entries.length > 0 && (
          <section aria-label="最近连接" className="grid gap-2 border-b border-border pb-4">
            <strong className="font-semibold">最近连接</strong>
            {history.entries.map((row) => {
              const address = reconnectAddress(row, discovery.services);
              return (
                <div key={row.endpoint} className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 break-all">
                    {row.name}
                    <small className="block text-xs leading-4 text-muted-foreground">{address}</small>
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    aria-label={`重连 ${address}`}
                    onClick={() => {
                      switchMode("connect");
                      setEndpoint(address);
                      void run("connect", address);
                    }}
                  >
                    重连
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                    aria-label={`忘记 ${row.endpoint}`}
                    onClick={() => history.forget(row.endpoint)}
                  >
                    忘记
                  </Button>
                </div>
              );
            })}
          </section>
        )}
        {history.temporary && (
          <p className="text-xs leading-4 text-muted-foreground">历史变更仅在当前窗口有效。</p>
        )}
        {!pairedHost && (
          <div className="grid grid-cols-2 gap-1 rounded-lg bg-muted p-1">
            <Button
              variant="ghost"
              className="aria-pressed:bg-background aria-pressed:text-primary aria-pressed:shadow-sm"
              aria-pressed={!pair}
              disabled={busy}
              onClick={() => switchMode("connect")}
            >
              直接连接
            </Button>
            <Button
              variant="ghost"
              className="aria-pressed:bg-background aria-pressed:text-primary aria-pressed:shadow-sm"
              aria-pressed={pair}
              disabled={busy}
              onClick={() => switchMode("pair")}
            >
              配对码配对
            </Button>
          </div>
        )}
        {message && (
          <p role="status" className="rounded-md bg-muted p-3 text-sm text-foreground">
            {message}
          </p>
        )}
        {pairedHost ? (
          <div className="grid gap-3">
            <p role="status" className="rounded-md bg-muted p-3 text-sm text-foreground">
              配对成功。请等待设备上线，或选择附近设备的连接端口。
            </p>
            {reliable && devices.some(online) && (
              <ul aria-label="当前在线设备" className="grid gap-1 break-all text-xs text-muted-foreground">
                {devices.filter(online).map((d) => (
                  <li key={d.serial}>
                    {d.name} · {d.serial}
                  </li>
                ))}
              </ul>
            )}
            <div className="flex flex-wrap justify-end gap-2">
              <DialogClose asChild>
                <Button>返回设备列表</Button>
              </DialogClose>
              <Button
                variant="outline"
                onClick={() => {
                  switchMode("connect");
                  setMessage("请输入无线调试主页显示的连接端口。");
                }}
              >
                手动连接
              </Button>
            </div>
          </div>
        ) : (
          <form onSubmit={submit} className="grid gap-2">
            <label className="font-medium" htmlFor="endpoint">{pair ? "配对地址" : "连接地址"}</label>
            <Input
              className="border-border bg-background text-sm"
              id="endpoint"
              autoComplete="off"
              spellCheck={false}
              placeholder={
                pair ? "例如 192.168.1.20:41234" : "例如 192.168.1.20"
              }
              value={endpoint}
              disabled={busy}
              onChange={(e) => setEndpoint(e.target.value)}
            />
            <p className="text-xs leading-4 text-muted-foreground">
              {pair
                ? "打开“使用配对码配对设备”，填写弹窗中的地址和端口。"
                : "输入电视或盒子的 IP 即可，默认使用 5555 端口。"}
            </p>
            {!pair && (
              <>
                <Button
                  type="button"
                  variant="link"
                  className="justify-self-start px-0"
                  size="sm"
                  disabled={busy}
                  onClick={() => {
                    setShowPort(!showPort);
                    setCustomPort("");
                  }}
                >
                  {showPort ? "使用默认端口" : "自定义连接端口"}
                </Button>
                {showPort && (
                  <label className="grid gap-2 font-medium">
                    连接端口
                    <Input
                      className="border-border bg-background text-sm"
                      value={customPort}
                      inputMode="numeric"
                      placeholder="5555"
                      onChange={(e) => setCustomPort(e.target.value)}
                    />
                  </label>
                )}
              </>
            )}
            {pair && (
              <>
                <label className="font-medium" htmlFor="code">六位配对码</label>
                <Input
                  className="border-border bg-background text-sm"
                  id="code"
                  inputMode="numeric"
                  autoComplete="off"
                  maxLength={6}
                  value={code}
                  disabled={busy}
                  onChange={(e) => setCode(e.target.value)}
                />
              </>
            )}
            {error && (
              <p role="alert" className="break-words text-sm text-destructive">
                {error}
              </p>
            )}
            <Button type="submit" className="mt-2 justify-self-end" disabled={busy}>
              {busy ? "请稍候…" : pair ? "配对设备" : "连接设备"}
            </Button>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
