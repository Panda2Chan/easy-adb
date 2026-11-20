import { useState, useEffect, type ReactNode } from "react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
} from "./ui/dialog";
import logo from "../../public/easy-adb-mark.svg?inline";
import { Cable, LockKeyhole, RefreshCw, Smartphone } from "lucide-react";
import { type Device, type Bridge, errorText } from "@/lib/bridge";
import { online, stateText } from "@/lib/devices";
import { Button } from "./ui/button";

type Props = {
  bridge: Bridge;
  children: ReactNode;
  devices: Device[];
  serial: string;
  select: (serial: string) => void;
  locked: boolean;
  available: boolean;
  scanning: boolean;
  scanError: string;
  refresh: () => void;
};
export function DevicePanel({
  bridge,
  children,
  devices,
  serial,
  select,
  locked,
  available,
  scanning,
  scanError,
  refresh,
}: Props) {
  const [appVersion, setVersion] = useState(bridge.appVersion);
  const [linkError, setLinkError] = useState("");
  useEffect(() => {
    let active = true;
    if (!bridge.appVersion && bridge.available)
      bridge
        .request("version", {})
        .then((v) => {
          if (active) setVersion(v);
        })
        .catch(() => {});
    return () => {
      active = false;
    };
  }, [bridge]);
  return (
    <aside className="rail">
      <div className="brand">
        <img src={logo} alt="" />
        Easy ADB
      </div>
      <div className="railbody">
        <div className="railtitle">我的设备</div>
        {scanError && (
          <p role="alert" className="error">
            设备扫描失败：{scanError}
          </p>
        )}
        {devices.length ? (
          <div className="device-list">
            {devices.map((device) => (
              <button
                type="button"
                key={device.serial}
                className="device"
                aria-pressed={serial === device.serial}
                disabled={locked || !online(device) || !!scanError}
                onClick={() => select(device.serial)}
              >
                <Smartphone />
                <span className="device-data">
                  <strong>{device.name || device.serial}</strong>
                  <code>{device.serial}</code>
                  <small>{stateText(device)}</small>
                </span>
                {device.serial === serial && <LockKeyhole size={14} />}
              </button>
            ))}
          </div>
        ) : (
          <div className="empty">
            <span className="device-icon">
              <Cable size={29} />
            </span>
            <strong>暂无设备</strong>
            <p>使用数据线连接设备，或通过无线连接添加。</p>
          </div>
        )}
        <Button
          variant="ghost"
          size="sm"
          disabled={!available || scanning}
          onClick={refresh}
          aria-label="刷新 USB 和无线设备"
        >
          <RefreshCw className={scanning ? "spin" : ""} />
          刷新列表
        </Button>
        <p className="railtitle connections">连接设备</p>
        <Dialog>
          <DialogTrigger asChild>
            <Button
              variant="ghost"
              className="railbtn"
              disabled={!available || locked}
              onClick={refresh}
            >
              <Cable />
              USB 连接
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogTitle>USB 连接</DialogTitle>
            <DialogDescription>
              使用数据线连接电脑和设备，开启 USB 调试，在设备上允许此电脑连接。
            </DialogDescription>
            <div role="status">
              {devices
                .filter(
                  (d) => !d.serial.includes(":") && !d.serial.includes("._tcp"),
                )
                .map((d) => (
                  <p key={d.serial}>
                    {d.name || d.serial} · {stateText(d)}
                  </p>
                ))}
              {!devices.some(
                (d) => !d.serial.includes(":") && !d.serial.includes("._tcp"),
              ) && "等待 USB 设备…"}
            </div>
            <Button variant="outline" onClick={refresh} disabled={scanning}>
              重新检测
            </Button>
          </DialogContent>
        </Dialog>
        {children}
      </div>
      <footer className="about">
        {appVersion && <span>v{appVersion}</span>}
        <a
          href="https://github.com/Panda2Chan/easy-adb"
          target="_blank"
          rel="noreferrer"
          onClick={(e) => {
            if (bridge.available) {
              e.preventDefault();
              bridge
                .request("openRepository", {})
                .catch((err) => setLinkError(errorText(err)));
            }
          }}
        >
          <svg
            aria-hidden="true"
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="currentColor"
          >
            <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82A7.48 7.48 0 018 3.86c.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
          </svg>
          easy-adb
        </a>
        <small>Powered by PanChan</small>
        {linkError && <small role="alert">{linkError}</small>}
      </footer>
    </aside>
  );
}
