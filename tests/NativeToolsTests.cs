using System.Net;
using System.Text.Json;
using EasyAdb.Core;
using Xunit;

namespace EasyAdb.Tests;

public class NativeToolsTests(FakeAdb fake) : IClassFixture<FakeAdb>
{
    [Fact]
    public async Task DiscoveryUsesOnlyAdvertisementsAndFiltersRecords()
    {
        fake.Reply(["mdns", "services"], "List of discovered mdns services\na _adb-tls-connect._tcp. 192.168.1.8:3210\na _adb-tls-connect._tcp 192.168.1.8:3210\nb _adb-tls-pairing._tcp [fd00::1]:44\nc _http._tcp 192.168.1.9:5555\nd _adb._tcp bad:12\ne _adb._tcp 1.2.3.4:65536");
        var rows = await new AdbClient(fake.Executable).DiscoverAsync(null, default);
        Assert.Equal(new[] { new Discovery("192.168.1.8:3210", "a", "connect"), new Discovery("[fd00::1]:44", "b", "pair") }, rows);
        Assert.Equal(1, fake.Calls);
    }

    [Fact]
    public async Task TextQuotesRemoteArgumentAndPreservesLiteralPercentS()
    {
        const string text = " a'b;$`& %s ";
        fake.Reply(["-s", "USB1", "shell", "input text ' a'\\''b;$`& %' && input text 's '"], "");
        var adb = new AdbClient(fake.Executable);
        await adb.SendTextAsync("USB1", text, default);
        foreach (var invalid in new[] { "中文", "\ta", "\n", "" })
            await Assert.ThrowsAsync<ArgumentException>(() => adb.SendTextAsync("USB1", invalid, default));
        Assert.Equal(1, fake.Calls);
    }

    [Theory]
    [InlineData("192.168.1.5:5555", "192.168.1.5")]
    [InlineData("172.16.1.2", "172.16.1.2")]
    [InlineData("8.8.8.8", null)]
    [InlineData("10.1.1.255", null)]
    [InlineData("10.1.1.1:1234", null)]
    [InlineData("10.1.1.1/24", null)]
    public void HomeAddressIsOnePrivateLiteral(string value, string? expected) => Assert.Equal(expected, NativeTools.HomeAddress(value)?.ToString());

    [Fact]
    public async Task ReleaseParsesOnlyBoundedSuccessfulOfficialResponse()
    {
        foreach (var (body, status, valid) in new[] { ("{\"tag_name\":\"v1.2.3\"}", HttpStatusCode.OK, true), ("{}", HttpStatusCode.OK, false), ("{\"tag_name\":3}", HttpStatusCode.OK, false), (new string(' ', 262145), HttpStatusCode.OK, false), ("{}", HttpStatusCode.Redirect, false) })
        {
            using var http = new HttpClient(new Handler(body, status));
            if (valid) Assert.Equal("1.2.3", await NativeTools.LatestAsync(http, default));
            else await Assert.ThrowsAnyAsync<Exception>(() => NativeTools.LatestAsync(http, default));
        }
        Assert.Equal("https://github.com/Panda2Chan/easy-adb/releases/latest", NativeTools.Releases);
    }

    [Theory]
    [InlineData("discoverDevices", "{}", true)]
    [InlineData("discoverDevices", "{\"hosts\":[]}", false)]
    [InlineData("checkUpdate", "null", false)]
    [InlineData("openReleases", "{\"url\":1}", false)]
    [InlineData("sendText", "{\"serial\":\"USB\",\"text\":\"a\"}", true)]
    [InlineData("sendText", "{\"serial\":\"USB\",\"text\":true}", false)]
    [InlineData("sendText", "{\"serial\":\"USB\"}", false)]
    public void ActionsValidatePayloadBeforeDispatch(string action, string raw, bool valid)
    {
        using var json = JsonDocument.Parse(raw);
        if (valid) NativeTools.ValidatePayload(action, json.RootElement);
        else Assert.Throws<ArgumentException>(() => NativeTools.ValidatePayload(action, json.RootElement));
    }

    private sealed class Handler(string body, HttpStatusCode status) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
        {
            Assert.Equal("https://api.github.com/repos/Panda2Chan/easy-adb/releases/latest", request.RequestUri!.AbsoluteUri);
            return Task.FromResult(new HttpResponseMessage(status) { Content = new StringContent(body) });
        }
    }
}
