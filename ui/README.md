# Easy ADB 中文安装台

Windows WebView2 的单窗前端，使用 React、TypeScript、Vite、Tailwind CSS 和本地 shadcn/ui 组件。使用 Node.js 22 LTS，在本目录运行：

```sh
npm ci
npm test
npm run build
```

`dist/` 包含完整静态资源，交给宿主映射至 `wwwroot/`。使用 `npm run dev` 可在浏览器预览系统明暗主题和空设备状态。设备操作需要 WebView2。

## 文件说明

- `src/App.tsx` 管理明确选定的设备序列号、安装来源、进度和取消状态。
- `src/lib/bridge.ts` 处理 WebView2 请求、乱序响应、事件订阅和原生文件拖入。
- `src/lib/devices.ts` 维护设备列表。同一时刻最多一个扫描请求，后台页面暂停轮询。扫描失败时暂停安装，任务错误独立保留。
- `src/components/DevicePanel.tsx` 显示设备状态、授权提示和 USB 连接帮助。
- `src/components/Wireless.tsx` 处理直接连接与六位码配对。配对后检查在线列表。对于无法通过地址识别的无线设备，展示真实在线设备供用户核对。
- `src/components/ui/` 保存 shadcn/ui 官方 `new-york-v4` registry 的 Button 与 Input 源码，`cn` 导入映射到本地 `src/lib/utils.ts`。
- `components.json` 定义组件和主题路径。`src/styles.css` 包含 Tailwind 基础样式、shadcn 语义颜色、单窗布局和系统暗色主题。
- `tests/` 使用 Vitest、Testing Library 与模拟消息端口验证宿主协议和交互。

## 宿主约定

普通请求为 `{id, action, payload}`，按 ID 接收 `{id, result}` 或 `{id, error}`。支持 `list`、`connect`、`pair`、`pick`、`install` 和 `cancel`。仅发送一个安装来源字段。取消请求成功后继续等待原安装请求结束。

拖放通过 `postMessageWithAdditionalObjects({action:'drop'}, [file])` 传递文件。宿主读取 `CoreWebView2File.Path`，回传 `file` 事件后才采用该路径。`stage` 事件显示当前阶段，`progress` 显示百分比。
