import {
  Cable,
  LockKeyhole,
  MonitorSmartphone,
  RefreshCw,
  Smartphone,
  Usb,
} from "lucide-react";
import { type Device } from "@/lib/bridge";
import { online, stateText } from "@/lib/devices";
import { Button } from "./ui/button";

type Props = {
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
  devices,
  serial,
  select,
  locked,
  available,
  scanning,
  scanError,
  refresh,
}: Props) {
  return (
    <aside className="panel sidebar">
      <div className="section-head">
        <h2>
          <MonitorSmartphone />
          设备列表
        </h2>
        <span className="counter" aria-label={`${devices.length} 台设备`}>
          {devices.length}
        </span>
      </div>
      <p className="hint">选择一台设备，锁定本次安装目标。</p>
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
        variant="outline"
        className="refresh"
        disabled={!available || scanning}
        onClick={refresh}
      >
        <RefreshCw className={scanning ? "spin" : ""} />
        刷新 USB
      </Button>
      <details className="guide">
        <summary>
          <Usb size={15} />
          USB 连接帮助
        </summary>
        <p>
          在设备的开发者选项中开启 USB
          调试，使用支持数据传输的线缆连接电脑。解锁设备，接受调试授权后刷新列表。
        </p>
      </details>
    </aside>
  );
}
