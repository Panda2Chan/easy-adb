using System;
using System.Collections.Generic;
using System.IO;
using System.IO.Compression;
using System.Net;
using System.Net.Http;
using System.Threading;
using System.Threading.Tasks;

namespace EasyAdb.Core;

public sealed record DownloadBytes(long Received, long? Total);

public sealed class ApkDownloader(HttpClient client, string directory)
{
    private const long MaxBytes = 512L * 1024 * 1024;
    private const int BufferSize = 64 * 1024;
    private readonly string sessionDirectory = Path.GetFullPath(directory);
    private readonly Dictionary<string, (string Path, long Length)> cache = new(StringComparer.Ordinal);
    private readonly SemaphoreSlim gate = new(1, 1);

    public async Task<string> DownloadAsync(string url, IProgress<int> progress, CancellationToken ct, IProgress<DownloadBytes>? bytes = null)
    {
        if (!Uri.TryCreate(url, UriKind.Absolute, out var uri) || string.IsNullOrEmpty(uri.Host) ||
            (uri.Scheme != Uri.UriSchemeHttp && uri.Scheme != Uri.UriSchemeHttps))
            throw new ArgumentException("请输入完整的 HTTP 或 HTTPS 下载地址。", nameof(url));

        // 同一会话串行发布文件，重叠的重试可直接复用刚完成的下载。
        await gate.WaitAsync(ct).ConfigureAwait(false);
        try
        {
            if (cache.TryGetValue(url, out var cached))
            {
                var file = new FileInfo(cached.Path);
                if (file.Exists && file.Length == cached.Length)
                {
                    bytes?.Report(new(file.Length, file.Length));
                    progress.Report(100);
                    return cached.Path;
                }
                cache.Remove(url);
            }

            progress.Report(0);
            using var response = await client.GetAsync(uri, HttpCompletionOption.ResponseHeadersRead, ct).ConfigureAwait(false);
            response.EnsureSuccessStatusCode();
            if (response.StatusCode == HttpStatusCode.PartialContent)
                throw new InvalidDataException("服务器仅返回了部分 APK。");
            long? expected = response.Content.Headers.ContentLength;
            if (expected is > MaxBytes)
                throw new InvalidDataException("APK 超过 512 MiB 大小上限。");

            bytes?.Report(new(0, expected));
            Directory.CreateDirectory(sessionDirectory);
            string finalPath = Path.Combine(sessionDirectory, Guid.NewGuid().ToString("N") + ".apk");
            string partialPath = finalPath + ".part";
            string? ownedPath = null;
            try
            {
                long length;
                using (var file = new FileStream(partialPath, FileMode.CreateNew, FileAccess.ReadWrite,
                           FileShare.None, BufferSize, useAsync: true))
                {
                    ownedPath = partialPath;
                    using var source = await response.Content.ReadAsStreamAsync(ct).ConfigureAwait(false);
                    length = await CopyAsync(source, file, expected, progress, bytes, ct).ConfigureAwait(false);
                    file.Position = 0;
                    using var zip = new ZipArchive(file, ZipArchiveMode.Read, leaveOpen: true);
                    if (!(zip.GetEntry("AndroidManifest.xml") is not null || zip.GetEntry("toc.pb") is not null ||
                          zip.GetEntry("manifest.json") is not null || zip.Entries.Any(entry => entry.FullName.EndsWith(".apk", StringComparison.OrdinalIgnoreCase))))
                        throw new InvalidDataException("无法识别 Android 安装包。");
                }

                // 校验和关闭文件后才发布最终文件名并报告完成。
                ct.ThrowIfCancellationRequested();
                File.Move(partialPath, finalPath);
                ownedPath = finalPath;
                progress.Report(100);
                cache[url] = (finalPath, length);
                ownedPath = null;
                return finalPath;
            }
            finally
            {
                if (ownedPath is not null) File.Delete(ownedPath);
            }
        }
        finally
        {
            gate.Release();
        }
    }

    private static async Task<long> CopyAsync(Stream source, Stream file, long? expected, IProgress<int> progress,
        IProgress<DownloadBytes>? bytes, CancellationToken ct)
    {
        var buffer = new byte[BufferSize];
        long total = 0;
        int lastPercent = 0;
        long lastReport = 0;
        long reportedBytes = 0;
        int count;
        while ((count = await source.ReadAsync(buffer.AsMemory(), ct).ConfigureAwait(false)) != 0)
        {
            total += count;
            if (total > MaxBytes) throw new InvalidDataException("APK 超过 512 MiB 大小上限。");
            if (expected.HasValue && total > expected.Value)
                throw new InvalidDataException("下载内容超过服务器声明的长度。");
            await file.WriteAsync(buffer.AsMemory(0, count), ct).ConfigureAwait(false);
            // 限制 WebView 消息频率，快速或分块下载也能报告准确的末次字节数。
            long now = Environment.TickCount64;
            if (now - lastReport >= 100)
            {
                bytes?.Report(new(total, expected));
                lastReport = now;
                reportedBytes = total;
            }
            if (expected is > 0)
            {
                int percent = (int)Math.Min(99, total * 100 / expected.Value);
                if (percent != lastPercent)
                {
                    progress.Report(percent);
                    lastPercent = percent;
                }
            }
        }
        ct.ThrowIfCancellationRequested();
        if (expected.HasValue && total != expected.Value)
            throw new InvalidDataException("下载内容与服务器声明的长度不符。");
        if (reportedBytes != total) bytes?.Report(new(total, expected));
        return total;
    }
}
