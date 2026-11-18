# Easy ADB

用 Windows 电脑给安卓手机、电视或盒子安装应用。选择一台设备后，拖入一个本地 APK，或粘贴 APK 下载直链。安装任务始终使用点击安装时的目标设备。

## 在 Windows 上启动

下载并运行 **EasyADB-Setup-x64.exe**。接受 Android SDK 许可后，安装程序会从 Google 下载并校验 Android 连接工具，并在需要时从微软安装 WebView2。首次安装请保持联网。完成后从开始菜单打开 **Easy ADB**，连接设备即可安装 APK。

安装包可在仓库 **Actions → Windows build → easy-adb-windows-installer** 获取。应用安装到当前用户目录，支持 Windows 10 2004 及以上 x64 系统。

## 连接与安装

- **USB**　开启设备的 USB 调试，用支持数据传输的线连接。解锁设备并允许调试，设备会出现在列表中。
- **网络地址**　让电脑和设备处于可互通的局域网，在设备设置中开启网络 ADB，输入设备显示的 IP 和连接端口。
- **无线配对**　在支持无线调试的设备上打开“使用配对码配对设备”，输入配对地址和六位码。若配对后未自动上线，返回设备的无线调试主页，使用该页显示的连接端口。配对端口与连接端口可能不同。
- **安装**　选择在线设备。可拖入或选择一个 APK，也可粘贴 HTTP(S) APK 直链。下载上限 512 MiB。同一窗口重试相同链接时会复用已完成的下载。仅安装自己信任的来源。

## 兼容验证

首批真机目标为国行海信 85E7Q 和小米电视盒子。兼容情况取决于具体固件开放的 ADB 能力。两类设备当前均待实测。验收时记录型号和固件，并分别验证本地 APK、链接安装、目标选择和电视端启动。

## 本地开发

界面使用 React、TypeScript、shadcn/ui 和 Vite。Windows 宿主通过 WebView2 加载本地资源。C# 核心库处理 ADB 子进程、下载、取消及缓存。

在 Windows 上准备 Node.js 22 和 .NET 10 SDK，从仓库根目录执行：

```powershell
cd ui
npm ci
npm test
npm run build
cd ..
dotnet test tests/EasyAdb.Tests.csproj
dotnet run --project src/EasyAdb.Windows
```

生成自包含的 x64 便携目录：

```powershell
dotnet publish src/EasyAdb.Windows -c Release -r win-x64 --self-contained true -o out
```
