import { useCallback, useEffect, useRef, useState } from "react";
import { type Bridge, type Device, errorText } from "./bridge";

export function useDevices(bridge: Bridge) {
  const [devices, setDevices] = useState<Device[]>([]);
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState("");
  const flight = useRef<Promise<void> | null>(null);
  const alive = useRef(false);
  const refresh = useCallback(() => {
    if (!bridge.available || flight.current) return flight.current;
    setScanning(true);
    flight.current = bridge
      .request("list", {})
      .then((list) => {
        if (
          !Array.isArray(list) ||
          !list.every(
            (d) =>
              d &&
              typeof d.serial === "string" &&
              typeof d.state === "string" &&
              typeof d.name === "string",
          )
        )
          throw new Error("宿主返回的设备列表无效。");
        if (alive.current) {
          setDevices(list);
          setScanError("");
        }
      })
      .catch((err) => {
        if (alive.current) setScanError(errorText(err));
      })
      .finally(() => {
        flight.current = null;
        if (alive.current) setScanning(false);
      });
    return flight.current;
  }, [bridge]);
  useEffect(() => {
    alive.current = true;
    void refresh();
    const poll = () => {
      if (!document.hidden) void refresh();
    };
    const timer = setInterval(poll, 5000);
    document.addEventListener("visibilitychange", poll);
    return () => {
      alive.current = false;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", poll);
    };
  }, [refresh]);
  return { devices, refresh, scanning, scanError };
}
export const online = (device?: Device) =>
  device?.state.toLowerCase() === "device" ||
  device?.state.toLowerCase() === "online";
export function stateText(device: Device) {
  if (online(device)) return "在线";
  return (
    (
      {
        unauthorized: "未授权 · 请在设备上允许调试",
        offline: "离线 · 请重新连接设备",
      } as Record<string, string>
    )[device.state.toLowerCase()] ?? `不可用 · ${device.state}`
  );
}
