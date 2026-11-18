using System.ComponentModel;
using System.IO;
using System.Net.Http;
using System.Text.Json;
using System.Windows;
using EasyAdb.Core;
using Microsoft.Web.WebView2.Core;
using Microsoft.Win32;

namespace EasyAdb.Windows;

public partial class MainWindow : Window
{
    private const string Host = "easy-adb.invalid";
    private const string StartPage = "https://" + Host + "/index.html";
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    private readonly string session = Path.Combine(Path.GetTempPath(), "easy-adb", Guid.NewGuid().ToString("N"));
    private readonly HttpClient http = new() { Timeout = TimeSpan.FromMinutes(15) };
    private readonly CancellationTokenSource lifetime = new();
    private readonly HashSet<string> selectedFiles = new(StringComparer.OrdinalIgnoreCase);
    private readonly ApkDownloader downloader;
    private CancellationTokenSource? installing;
    private bool closing;
    private readonly bool verifyInstallation = Environment.GetCommandLineArgs().Contains("--verify-installation");

    public MainWindow()
    {
        InitializeComponent();
        downloader = new ApkDownloader(http, session);
    }

    private async void OnLoaded(object sender, RoutedEventArgs args)
    {
        try
        {
            var profile = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "EasyAdb", "WebView2");
            var environment = await CoreWebView2Environment.CreateAsync(userDataFolder: profile);
            await Browser.EnsureCoreWebView2Async(environment);
            var web = Browser.CoreWebView2;
            web.Settings.AreDevToolsEnabled = false;
            web.Settings.AreHostObjectsAllowed = false;
            web.Settings.AreDefaultContextMenusEnabled = false;
            web.SetVirtualHostNameToFolderMapping(Host, Path.Combine(AppContext.BaseDirectory, "wwwroot"), CoreWebView2HostResourceAccessKind.Deny);
            web.NavigationStarting += (_, e) => e.Cancel = e.Uri != StartPage;
            web.NewWindowRequested += (_, e) => e.Handled = true;
            web.PermissionRequested += (_, e) => e.State = CoreWebView2PermissionState.Deny;
            web.WebMessageReceived += Receive;
            if (verifyInstallation)
            {
                web.NavigationCompleted += (_, e) => Console.WriteLine($"Navigation: {e.IsSuccess} {e.WebErrorStatus}");
                await web.AddScriptToExecuteOnDocumentCreatedAsync("""
                    window.chrome.webview.addEventListener('message', ({data}) => {
                        if (Array.isArray(data.result) && document.querySelector('#root h1'))
                            window.chrome.webview.postMessage({action:'windowReady'});
                    });
                    """);
            }
            web.Navigate(StartPage);
        }
        catch (Exception ex) when (!closing)
        {
            if (verifyInstallation) { Console.Error.WriteLine(ex); Application.Current.Shutdown(1); return; }
            MessageBox.Show(this, "无法启动界面。请确认已安装 Microsoft Edge WebView2 Runtime。\n" + ex.Message, "Easy ADB");
            Close();
        }
        catch (Exception) when (closing) { }
    }

    private static AdbClient Client()
    {
        var local = Path.Combine(AppContext.BaseDirectory, "platform-tools", "adb.exe");
        if (File.Exists(local)) return new AdbClient(local);
        foreach (var dir in (Environment.GetEnvironmentVariable("PATH") ?? "").Split(Path.PathSeparator))
        {
            var path = dir.Trim().Trim('"');
            if (!Path.IsPathFullyQualified(path)) continue;
            var candidate = Path.Combine(path, "adb.exe");
            if (File.Exists(candidate)) return new AdbClient(candidate);
        }
        throw new FileNotFoundException("缺少 ADB 连接组件。请重新运行 Easy ADB 安装程序修复。");
    }

    private void Send(object message)
    {
        if (!closing) Browser.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(message, Json));
    }

    private async void Receive(object? sender, CoreWebView2WebMessageReceivedEventArgs args)
    {
        if (closing || args.Source != StartPage) return;
        JsonElement id = default;
        try
        {
            using var document = JsonDocument.Parse(args.WebMessageAsJson);
            var request = document.RootElement;
            var action = request.GetProperty("action").GetString();
            if (verifyInstallation && action == "windowReady")
            {
                Console.WriteLine("PASS: React window received installed ADB device list");
                _ = Dispatcher.BeginInvoke(new Action(() => Application.Current.Shutdown(0)));
                return;
            }
            if (action == "drop")
            {
                if (installing == null && args.AdditionalObjects?.OfType<CoreWebView2File>().FirstOrDefault() is { } file && IsApk(file.Path))
                {
                    selectedFiles.Add(file.Path);
                    Send(new { @event = "file", value = file.Path });
                }
                return;
            }
            id = request.GetProperty("id").Clone();
            request.TryGetProperty("payload", out var payload);
            string Text(string key) => payload.ValueKind == JsonValueKind.Object && payload.TryGetProperty(key, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString()! : "";
            object? result = null;
            switch (action)
            {
                case "list": result = await Client().ListAsync(lifetime.Token); break;
                case "connect": await Client().ConnectAsync(Text("endpoint"), lifetime.Token); break;
                case "pair": await Client().PairAsync(Text("endpoint"), Text("code"), lifetime.Token); break;
                case "pick":
                    var dialog = new OpenFileDialog { Filter = "Android 应用 (*.apk)|*.apk", CheckFileExists = true };
                    // 等 WebView2 消息回调返回，再打开原生模态对话框。
                    if (await Dispatcher.InvokeAsync(() => dialog.ShowDialog(this)) == true && IsApk(dialog.FileName))
                    {
                        selectedFiles.Add(dialog.FileName);
                        result = dialog.FileName;
                    }
                    break;
                case "install": await InstallAsync(Text("serial"), Text("file"), Text("url")); break;
                case "cancel": installing?.Cancel(); break;
                default: throw new InvalidOperationException("未知操作。");
            }
            Send(new { id, result });
        }
        catch (Exception ex)
        {
            if (id.ValueKind != JsonValueKind.Undefined)
                Send(new { id, error = ex is OperationCanceledException ? "操作已中止。可刷新设备后重试。" : ex.Message });
        }
    }

    private static bool IsApk(string file) => string.Equals(Path.GetExtension(file), ".apk", StringComparison.OrdinalIgnoreCase) && File.Exists(file);

    private async Task InstallAsync(string serial, string file, string url)
    {
        if (installing != null) throw new InvalidOperationException("已有安装任务正在进行。");
        if (string.IsNullOrWhiteSpace(serial)) throw new ArgumentException("请先选择目标设备。");
        if ((file.Length == 0) == (url.Length == 0)) throw new ArgumentException("请选择一个 APK 来源。");
        if (file.Length > 0 && (!selectedFiles.Contains(file) || !IsApk(file))) throw new ArgumentException("请重新选择本地 APK。");
        var client = Client();
        using var operation = CancellationTokenSource.CreateLinkedTokenSource(lifetime.Token);
        installing = operation;
        try
        {
            if (url.Length > 0)
            {
                Send(new { @event = "stage", value = "downloading" });
                using var deadline = CancellationTokenSource.CreateLinkedTokenSource(operation.Token);
                deadline.CancelAfter(TimeSpan.FromMinutes(15));
                try
                {
                    file = await downloader.DownloadAsync(url, new Progress<int>(p => Send(new { @event = "progress", value = p })), deadline.Token);
                }
                catch (OperationCanceledException) when (!operation.IsCancellationRequested)
                {
                    throw new TimeoutException("下载超时，请检查网络后重试。");
                }
            }
            Send(new { @event = "stage", value = "installing" });
            await client.InstallAsync(serial, file, operation.Token);
        }
        finally
        {
            installing = null;
            if (closing) _ = Dispatcher.BeginInvoke(new Action(Close));
        }
    }

    private void OnClosing(object? sender, CancelEventArgs args)
    {
        closing = true;
        lifetime.Cancel();
        if (installing != null) { args.Cancel = true; return; }
        http.Dispose();
        Browser.Dispose();
        try { if (Directory.Exists(session)) Directory.Delete(session, recursive: true); }
        catch (IOException) { }
        catch (UnauthorizedAccessException) { }
    }
}
