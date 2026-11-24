using System.Net;
using System.Net.Sockets;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace EasyAdb.Core;

public record Discovery(string Endpoint, string Name, string Kind);

public partial class AdbClient
{
    public async Task<IReadOnlyList<Discovery>> DiscoverAsync(IPAddress? home, CancellationToken ct)
    {
        var reply = await RunAsync(["mdns", "services"], TimeSpan.FromSeconds(10), ct);
        var lines = Lines(reply.Output);
        int header = Array.IndexOf(lines, "List of discovered mdns services");
        if (header < 0) throw reply.Failure();
        var rows = new List<Discovery>();
        var seen = new HashSet<(string, string)>();
        foreach (var line in lines.Skip(header + 1))
        {
            var f = line.Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries);
            if (f.Length != 3 || f[0].Length > 255 || f[0].Any(char.IsControl)) continue;
            var service = f[1].EndsWith('.') ? f[1][..^1] : f[1];
            string? kind = service switch { "_adb._tcp" or "_adb-tls-connect._tcp" => "connect", "_adb-tls-pairing._tcp" => "pair", _ => null };
            if (kind is null || !NativeTools.IsEndpoint(f[2]) || !seen.Add((f[2], kind))) continue;
            rows.Add(new(f[2], f[0], kind));
        }
        if (home != null && NativeTools.HomeAddress(home.ToString()) != null && !seen.Contains(($"{home}:5555", "connect")) && await NativeTools.HomeReachableAsync(home, ct))
            rows.Add(new($"{home}:5555", "家庭设备（5555 可达）", "connect"));
        return rows;
    }

    public async Task SendTextAsync(string serial, string text, CancellationToken ct)
    {
        if (serial.Length is 0 or > 255 || serial.Any(c => c < '!' || c > '~')) throw new ArgumentException("设备序列号无效。");
        if (text.Length is 0 or > 512 || text.Any(c => c < ' ' || c > '~'))
            throw new ArgumentException("仅支持 1–512 个可打印 ASCII 字符。ADB 无法可靠输入中文、表情或换行。");
        // 主机直接传 argv。设备端用单引号引用，拆开字面量 %s 以避开 Android 的空格替换。
        var escaped = text.Replace("'", "'\\''").Replace("%s", "%' && input text 's");
        var reply = await RunAsync(["-s", serial, "shell", $"input text '{escaped}'"], TimeSpan.FromSeconds(20), ct);
        if (reply.Error.Trim().Length > 0 || reply.Output.Trim().Length > 0) throw new InvalidOperationException("ADB 文本输入未成功确认。");
    }
}

public static class NativeTools
{
    public const string Releases = "https://github.com/Panda2Chan/easy-adb/releases/latest";
    private const int Limit = 256 * 1024;

    public static void ValidatePayload(string action, JsonElement payload)
    {
        if (action is not ("sendText" or "openReleases" or "checkUpdate" or "discoverDevices")) return;
        var keys = action == "sendText" ? new HashSet<string> { "serial", "text" } : [];
        if (payload.ValueKind != JsonValueKind.Object || payload.EnumerateObject().Any(p => !keys.Remove(p.Name) || p.Value.ValueKind != JsonValueKind.String) || keys.Count != 0)
            throw new ArgumentException("动作参数类型或字段无效。");
    }

    internal static bool IsEndpoint(string value)
    {
        var split = value.LastIndexOf(':');
        if (split <= 0 || !ushort.TryParse(value.AsSpan(split + 1), System.Globalization.NumberStyles.None, null, out var port) || port == 0) return false;
        var host = value[..split];
        if (host.StartsWith('[') && host.EndsWith(']'))
            return !host.Contains('%') && IPAddress.TryParse(host[1..^1], out var ip) && ip.AddressFamily == AddressFamily.InterNetworkV6;
        return IPAddress.TryParse(host, out var v4) && v4.AddressFamily == AddressFamily.InterNetwork && v4.ToString() == host;
    }

    public static IPAddress? HomeAddress(string endpoint)
    {
        var value = endpoint.Trim();
        var host = value.EndsWith(":5555", StringComparison.Ordinal) ? value[..^5] : value;
        if (!IPAddress.TryParse(host, out var ip) || ip.AddressFamily != AddressFamily.InterNetwork || ip.ToString() != host) return null;
        var b = ip.GetAddressBytes();
        bool home = b[0] == 10 || (b[0] == 172 && b[1] is >= 16 and <= 31) || (b[0] == 192 && b[1] == 168);
        return home && b[3] is > 0 and < 255 ? ip : null;
    }

    internal static async Task<bool> HomeReachableAsync(IPAddress home, CancellationToken ct)
    {
        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(ct);
        deadline.CancelAfter(700);
        using var socket = new TcpClient(AddressFamily.InterNetwork);
        try { await socket.ConnectAsync(home, 5555, deadline.Token); return true; }
        catch (OperationCanceledException) when (!ct.IsCancellationRequested) { return false; }
        catch (SocketException) { return false; }
    }

    public static async Task<string> LatestAsync(HttpClient http, CancellationToken ct)
    {
        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(ct);
        deadline.CancelAfter(TimeSpan.FromSeconds(8));
        using var request = new HttpRequestMessage(HttpMethod.Get, "https://api.github.com/repos/Panda2Chan/easy-adb/releases/latest");
        request.Headers.UserAgent.ParseAdd("EasyADB/1.0");
        request.Headers.Accept.ParseAdd("application/vnd.github+json");
        using var response = await http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, deadline.Token);
        if (response.StatusCode != HttpStatusCode.OK) throw new InvalidDataException($"GitHub 版本查询失败（HTTP {(int)response.StatusCode}）。");
        if (response.Content.Headers.ContentLength > Limit) throw new InvalidDataException("版本信息过大。");
        using var data = new MemoryStream();
        await using var stream = await response.Content.ReadAsStreamAsync(deadline.Token);
        var bytes = new byte[8192];
        int n;
        while ((n = await stream.ReadAsync(bytes, deadline.Token)) > 0)
        {
            if (data.Length + n > Limit) throw new InvalidDataException("版本信息过大。");
            data.Write(bytes, 0, n);
        }
        using var json = JsonDocument.Parse(data.ToArray());
        if (json.RootElement.ValueKind != JsonValueKind.Object || !json.RootElement.TryGetProperty("tag_name", out var tag) || tag.ValueKind != JsonValueKind.String || tag.GetString() is not { Length: <= 64 } name || !Regex.IsMatch(name, @"\Av?[0-9]+\.[0-9]+\.[0-9]+(?:[-+][0-9A-Za-z.-]+)?\z")) throw new InvalidDataException("发布版本号无效。");
        return name.TrimStart('v');
    }
}
