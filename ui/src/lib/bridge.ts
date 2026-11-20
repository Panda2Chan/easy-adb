export interface Device {
  serial: string;
  name: string;
  state: string;
}
export type Source =
  | { file: string; url?: never }
  | { url: string; file?: never };
type Empty = Record<string, never>;
export type InstalledApp = { packageName: string; isSystem: boolean };
type Payloads = {
  listApps: { serial: string };
  appInfo: { serial: string; packageName: string };
  uninstallApp: { serial: string; packageName: string };
  version: Empty;
  openRepository: Empty;
  list: Empty;
  pick: Empty;
  cancel: Empty;
  pair: { endpoint: string; code: string };
  connect: { endpoint: string };
  install: { serial: string } & Source;
};
type Results = {
  listApps: InstalledApp[];
  appInfo: { versionName: string | null; sizeBytes: number | null };
  uninstallApp: unknown;
  version: string;
  openRepository: unknown;
  list: Device[];
  pick: string | null;
  cancel: unknown;
  pair: unknown;
  connect: unknown;
  install: unknown;
};
export type HostEvent =
  | {
      event: "downloadBytes";
      value: { received: number; total: number | null };
    }
  | { event: "progress"; value: number }
  | { event: "file" | "stage"; value: string };
export interface HostPort {
  readonly appVersion?: string;
  postMessage(message: {
    id: string | number;
    action: keyof Payloads;
    payload: Payloads[keyof Payloads];
  }): void;
  postMessageWithAdditionalObjects?(
    message: { action: "drop" },
    files: File[],
  ): void;
  addEventListener(type: "message", listener: EventListener): void;
  removeEventListener(type: "message", listener: EventListener): void;
}
declare global {
  interface Window {
    chrome?: { webview?: HostPort };
  }
}

export const errorText = (err: unknown) =>
  err instanceof Error ? err.message : String(err);
export class Bridge {
  private nextId = 0;
  private waiting = new Map<string, (result: unknown, error?: Error) => void>();
  private listeners = new Set<(event: HostEvent) => void>();
  readonly available: boolean;
  private readonly port?: HostPort;

  constructor(port?: HostPort) {
    this.port = port;
    this.available = Boolean(port);
    port?.addEventListener("message", this.receive);
  }
  get appVersion() {
    return this.port?.appVersion;
  }
  private receive = (message: Event) => {
    const { data } = message as MessageEvent;
    if (!data || typeof data !== "object") return;
    if (
      "id" in data &&
      (typeof data.id === "number" || typeof data.id === "string")
    ) {
      if ("error" in data || "result" in data) {
        this.waiting.get(String(data.id))?.(
          data.result,
          data.error != null
            ? new Error(String(data.error.message ?? data.error))
            : undefined,
        );
      }
      return;
    }
    if (
      (data.event === "downloadBytes" &&
        Number.isFinite(data.value?.received)) ||
      (data.event === "progress" && Number.isFinite(data.value)) ||
      (["stage", "file"].includes(data.event) && typeof data.value === "string")
    ) {
      this.listeners.forEach((listener) => listener(data));
    }
  };
  request<K extends keyof Payloads>(
    action: K,
    payload: Payloads[K],
  ): Promise<Results[K]> {
    return new Promise((resolve, reject) => {
      if (!this.port)
        return reject(new Error("请在 Easy ADB 桌面应用中操作。"));
      const id = String(++this.nextId);
      let timer: ReturnType<typeof setTimeout> | undefined;
      const finish = (value: unknown, error?: Error) => {
        clearTimeout(timer);
        this.waiting.delete(id);
        if (error) reject(error);
        else resolve(value as Results[K]);
      };
      this.waiting.set(id, finish);
      // 枚举设备可安全重试。安装和文件选择必须等待宿主的真实结果。
      if (action === "list")
        timer = setTimeout(
          () => finish(null, new Error("设备扫描超时，请刷新 USB 重试。")),
          15000,
        );
      try {
        this.port.postMessage({ id, action, payload });
      } catch (err) {
        finish(null, new Error(errorText(err)));
      }
    });
  }
  subscribe(listener: (event: HostEvent) => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  drop(file: File) {
    if (!this.port?.postMessageWithAdditionalObjects)
      throw new Error("当前环境无法接收拖放，请使用“选择 APK”。");
    this.port.postMessageWithAdditionalObjects({ action: "drop" }, [file]);
  }
  dispose() {
    this.port?.removeEventListener("message", this.receive);
    this.listeners.clear();
    this.waiting.forEach((finish) =>
      finish(null, new Error("宿主连接已关闭。")),
    );
  }
}
