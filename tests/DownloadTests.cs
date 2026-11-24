using System;
using System.Collections.Generic;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Threading;
using System.Threading.Tasks;
using EasyAdb.Core;
using Xunit;

namespace EasyAdb.Tests;

public sealed class DownloadTests : IDisposable
{
    private const string Url = "https://example.test/releases/server.apk?version=1";
    private readonly string directory = Path.Combine(Path.GetTempPath(), Guid.NewGuid().ToString("N"));
    private readonly List<int> updates = new();
    private IProgress<int> Progress => new InlineProgress(updates.Add);

    [Theory]
    [InlineData("relative.apk")]
    [InlineData("file:///tmp/app.apk")]
    [InlineData("ftp://example.test/app.apk")]
    public async Task RejectsUnsupportedUrlsBeforeSending(string url)
    {
        var handler = new Handler(() => Ok(Apk()));
        using var client = new HttpClient(handler);
        var downloader = new ApkDownloader(client, directory);
        await Assert.ThrowsAsync<ArgumentException>(() => downloader.DownloadAsync(url, Progress, default));
        Assert.Equal(0, handler.Calls);
    }

    [Theory]
    [InlineData("http")]
    [InlineData("https")]
    public async Task UsesRandomNamesAndCachesByFullUrl(string scheme)
    {
        var bytes = Apk();
        var handler = new Handler(() => Ok(bytes));
        using var client = new HttpClient(handler);
        var downloader = new ApkDownloader(client, directory);
        string url = Url.Replace("https:", scheme + ":");
        var first = await downloader.DownloadAsync(url, Progress, default);
        Assert.Equal(bytes, File.ReadAllBytes(first));
        Assert.Equal(directory, Path.GetDirectoryName(first));
        Assert.NotEqual("server.apk", Path.GetFileName(first));
        Assert.Equal(".apk", Path.GetExtension(first));
        Assert.Equal(100, updates.Last());
        Assert.Equal(updates.OrderBy(n => n).ToArray(), updates.ToArray());
        Assert.Equal(first, await downloader.DownloadAsync(url, Progress, default));
        Assert.NotEqual(first, await downloader.DownloadAsync(url + "2", Progress, default));
        Assert.Equal(2, handler.Calls);
    }

    [Theory]
    [InlineData("toc.pb")]
    [InlineData("manifest.json")]
    [InlineData("base.apk")]
    public async Task DownloadPreservesSplitArchiveForPreflight(string entry)
    {
        var body = Apk(entry);
        using var client = new HttpClient(new Handler(() => Ok(body)));
        var path = await new ApkDownloader(client, directory).DownloadAsync("https://example.test/signed-link", Progress, default);
        Assert.Equal(body, File.ReadAllBytes(path));
    }

    private sealed class ByteProgress : IProgress<DownloadBytes>
    {
        public List<DownloadBytes> Values { get; } = [];
        public void Report(DownloadBytes value) => Values.Add(value);
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task ReportsReceivedBytesAndNullableTotal(bool known)
    {
        var bytes = Apk();
        using var client = new HttpClient(new Handler(() => new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = known ? new ByteArrayContent(bytes) : new StreamContent(new NonSeekableStream(bytes))
        }));
        var counts = new ByteProgress();
        var downloader = new ApkDownloader(client, directory);
        var path = await downloader.DownloadAsync(Url, Progress, default, counts);
        long? total = known ? bytes.Length : null;
        Assert.Equal(new DownloadBytes(0, total), counts.Values.First());
        Assert.Equal(new DownloadBytes(bytes.Length, total), counts.Values.Last());
        counts.Values.Clear();
        await downloader.DownloadAsync(Url, Progress, default, counts);
        Assert.Equal(new DownloadBytes(bytes.Length, bytes.Length), Assert.Single(counts.Values));
        Assert.Equal(bytes, File.ReadAllBytes(path));
        Assert.Equal(100, updates.Last());
    }

    [Theory]
    [InlineData("html")]
    [InlineData("nested")]
    [InlineData("short")]
    [InlineData("long")]
    [InlineData("oversize")]
    [InlineData("partial")]
    public async Task RejectsInvalidResponseAndRetriesCleanly(string failure)
    {
        var bytes = Apk();
        var bad = Ok(failure switch
        {
            "html" => System.Text.Encoding.UTF8.GetBytes("<html>login</html>"),
            "nested" => Apk("assets/AndroidManifest.xml"),
            _ => bytes
        });
        if (failure == "partial") bad.StatusCode = HttpStatusCode.PartialContent;
        if (failure == "short") bad.Content.Headers.ContentLength = bytes.Length + 1;
        if (failure == "long") bad.Content.Headers.ContentLength = bytes.Length - 1;
        if (failure == "oversize") bad.Content.Headers.ContentLength = 512L * 1024 * 1024 + 1;
        var replies = new Queue<HttpResponseMessage>(new[] { bad, Ok(bytes) });
        var handler = new Handler(replies.Dequeue);
        using var client = new HttpClient(handler);
        var downloader = new ApkDownloader(client, directory);
        await Assert.ThrowsAsync<InvalidDataException>(() => downloader.DownloadAsync(Url, Progress, default));
        AssertNoFiles();
        Assert.DoesNotContain(100, updates);
        Assert.Equal(bytes, File.ReadAllBytes(await downloader.DownloadAsync(Url, Progress, default)));
        Assert.Equal(2, handler.Calls);
    }

    [Fact]
    public async Task RejectsHttpFailure()
    {
        using var client = new HttpClient(new Handler(() => new HttpResponseMessage(HttpStatusCode.NotFound)));
        var downloader = new ApkDownloader(client, directory);
        await Assert.ThrowsAsync<HttpRequestException>(() => downloader.DownloadAsync(Url, Progress, default));
        AssertNoFiles();
    }

    [Fact]
    public async Task CancellationAfterWritingCleansPartialAndAllowsRetry()
    {
        var handler = new Handler(() => Ok(Apk()));
        using var client = new HttpClient(handler);
        using var cancel = new CancellationTokenSource();
        var downloader = new ApkDownloader(client, directory);
        var progress = new InlineProgress(value =>
        {
            updates.Add(value);
            if (value > 0 && value < 100) cancel.Cancel();
        });
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => downloader.DownloadAsync(Url, progress, cancel.Token));
        AssertNoFiles();
        Assert.DoesNotContain(100, updates);
        Assert.True(File.Exists(await downloader.DownloadAsync(Url, Progress, default)));
        Assert.Equal(2, handler.Calls);
    }

    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public async Task DownloadsAgainIfCachedFileIsMissingOrTruncated(bool missing)
    {
        var bytes = Apk();
        var handler = new Handler(() => Ok(bytes));
        using var client = new HttpClient(handler);
        var downloader = new ApkDownloader(client, directory);
        var first = await downloader.DownloadAsync(Url, Progress, default);
        if (missing) File.Delete(first);
        else File.WriteAllBytes(first, Array.Empty<byte>());
        var next = await downloader.DownloadAsync(Url, Progress, default);
        Assert.Equal(bytes, File.ReadAllBytes(next));
        Assert.Equal(2, handler.Calls);
    }

    private static byte[] Apk(string entry = "AndroidManifest.xml")
    {
        using var bytes = new MemoryStream();
        using (var zip = new ZipArchive(bytes, ZipArchiveMode.Create, leaveOpen: true))
        using (var manifest = zip.CreateEntry(entry).Open())
            manifest.WriteByte(1);
        return bytes.ToArray();
    }

    private static HttpResponseMessage Ok(byte[] bytes) => new(HttpStatusCode.OK) { Content = new ByteArrayContent(bytes) };

    private void AssertNoFiles()
    {
        if (Directory.Exists(directory)) Assert.Empty(Directory.GetFileSystemEntries(directory));
    }

    public void Dispose()
    {
        if (Directory.Exists(directory)) Directory.Delete(directory, recursive: true);
    }

    private sealed class Handler(Func<HttpResponseMessage> response) : HttpMessageHandler
    {
        public int Calls { get; private set; }
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            Calls++;
            return Task.FromResult(response());
        }
    }

    private sealed class InlineProgress(Action<int> report) : IProgress<int>
    {
        public void Report(int value) => report(value);
    }

    private sealed class NonSeekableStream(byte[] bytes) : MemoryStream(bytes)
    {
        public override bool CanSeek => false;
    }
}
