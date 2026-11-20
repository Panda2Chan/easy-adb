import { useEffect, useState } from "react";
import { Dialog } from "radix-ui";
import { Wifi, X } from "lucide-react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { online } from "@/lib/devices";
import { type Bridge, type Device, errorText } from "@/lib/bridge";

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
  const [pairedHost, setPairedHost] = useState("");
  const connected =
    reliable &&
    devices.find(
      (d) =>
        online(d) &&
        d.serial.slice(0, d.serial.lastIndexOf(":")).toLowerCase() ===
          pairedHost,
    );
  const [awaiting, setAwaiting] = useState("");
  const [customPort, setCustomPort] = useState("");
  const [showPort, setShowPort] = useState(false);
  useEffect(() => {
    if (!open || !reliable) return;
    const match = awaiting
      ? devices.find(
          (d) => online(d) && d.serial.toLowerCase() === awaiting.toLowerCase(),
        )
      : pairedHost
        ? connected
        : undefined;
    if (match) {
      onConnected(match.serial, match.name || match.serial);
      setOpen(false);
      setAwaiting("");
      setPairedHost("");
    }
  }, [devices, awaiting, pairedHost, connected, open, reliable, onConnected]);
  const pair = mode === "pair";
  function switchMode(value: typeof mode) {
    setPairedHost("");
    setMode(value);
    setEndpoint("");
    setAwaiting("");
    setCustomPort("");
    setShowPort(false);
    setCode("");
    setError("");
    setMessage("");
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    const host = endpoint.trim();
    const address =
      pair || /:\d+$/.test(host) ? host : `${host}:${customPort || "5555"}`;
    const port = /^(?:\[[\da-fA-F:.]+\]|[\w.-]+):(\d{1,5})$/.exec(address)?.[1];
    if (!port || +port < 1 || +port > 65535)
      return setError("请输入完整的设备地址和端口。");
    if (pair && !/^\d{6}$/.test(code))
      return setError("请输入设备显示的六位配对码。");
    setError("");
    setMessage("");
    setBusy(true);
    try {
      if (pair) {
        await bridge.request("pair", { endpoint: address, code });
        switchMode("connect");
        setPairedHost(address.slice(0, address.lastIndexOf(":")).toLowerCase());
        refresh();
      } else {
        await bridge.request("connect", { endpoint: address });
        setAwaiting(address);
        setMessage("设备已接受连接，正在确认在线状态。请在设备上允许调试。");
        refresh();
      }
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!busy) {
          setOpen(next);
          switchMode("connect");
        }
      }}
    >
      <Dialog.Trigger asChild>
        <Button
          className="railbtn"
          variant="ghost"
          disabled={disabled}
          aria-label="无线连接"
        >
          <Wifi />
          Wi-Fi 连接
        </Button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/35" />
        <Dialog.Content className="dialog fixed top-1/2 left-1/2 z-50 grid w-[min(420px,94vw)] max-h-[94vh] overflow-auto -translate-x-1/2 -translate-y-1/2 gap-3 rounded-xl border bg-white p-6 shadow-lg">
          <div className="section-head">
            <Dialog.Title>无线连接</Dialog.Title>
            <Dialog.Close asChild>
              <Button
                variant="ghost"
                size="icon"
                aria-label="关闭"
                disabled={busy}
              >
                <X />
              </Button>
            </Dialog.Close>
          </div>
          <Dialog.Description className="muted">
            将电脑与设备接入同一网络，并在设备上开启网络或无线调试。
          </Dialog.Description>
          {!pairedHost && (
            <div className="segments">
              <Button
                variant="ghost"
                aria-pressed={!pair}
                disabled={busy}
                onClick={() => switchMode("connect")}
              >
                直接连接
              </Button>
              <Button
                variant="ghost"
                aria-pressed={pair}
                disabled={busy}
                onClick={() => switchMode("pair")}
              >
                配对码配对
              </Button>
            </div>
          )}
          {message && (
            <p role="status" className="notice">
              {message}
            </p>
          )}
          {pairedHost ? (
            <div className="pair-result">
              <p role="status" className="notice">
                {connected
                  ? `配对成功。${connected.name || connected.serial} 已上线。`
                  : "配对成功。请核对在线设备，只有配对设备未自动上线时才需要手动连接。"}
              </p>
              {!connected && reliable && devices.some(online) && (
                <ul aria-label="当前在线设备">
                  {devices.filter(online).map((d) => (
                    <li key={d.serial}>
                      {d.name} · {d.serial}
                    </li>
                  ))}
                </ul>
              )}
              <div className="pair-actions">
                <Dialog.Close asChild>
                  <Button>返回设备列表</Button>
                </Dialog.Close>
                {!connected && (
                  <Button
                    variant="outline"
                    onClick={() => {
                      switchMode("connect");
                      setMessage("请输入无线调试主页显示的连接端口。");
                    }}
                  >
                    手动连接
                  </Button>
                )}
              </div>
            </div>
          ) : (
            <form onSubmit={submit}>
              <label htmlFor="endpoint">{pair ? "配对地址" : "连接地址"}</label>
              <Input
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
              <p className="hint">
                {pair
                  ? "打开“使用配对码配对设备”，填写弹窗中的地址和端口。"
                  : "输入电视或盒子的 IP 即可，默认使用 5555 端口。"}
              </p>
              {!pair && (
                <>
                  <Button
                    type="button"
                    variant="link"
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
                    <label>
                      连接端口
                      <Input
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
                  <label htmlFor="code">六位配对码</label>
                  <Input
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
                <p role="alert" className="error">
                  {error}
                </p>
              )}
              <Button type="submit" className="submit" disabled={busy}>
                {busy ? "请稍候…" : pair ? "配对设备" : "连接设备"}
              </Button>
            </form>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
