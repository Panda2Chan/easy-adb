package main

import (
	"archive/zip"
	"bytes"
	"reflect"
	"testing"
)

func TestArchiveNames(t *testing.T) {
	for _, names := range [][]string{{"../base.apk"}, {"C:/base.apk"}, {"splits\\a.apk"}, {"a.apk", "A.apk"}, {"/base.apk"}, {"a/./b"}, {"a:stream"}} {
		var b bytes.Buffer
		w := zip.NewWriter(&b)
		for _, n := range names {
			w.Create(n)
		}
		w.Close()
		r, _ := zip.NewReader(bytes.NewReader(b.Bytes()), int64(b.Len()))
		if _, err := entries(r); err == nil {
			t.Errorf("accepted %v", names)
		}
	}
}
func TestPick(t *testing.T) {
	p := profile{33, []string{"arm64-v8a", "armeabi-v7a"}, 420, "zh-CN"}
	got, err := chooseFlat([]string{"", "config.en", "config.zh", "config.arm64_v8a", "config.armeabi_v7a", "config.xhdpi", "config.xxhdpi"}, p)
	if err != nil || !reflect.DeepEqual(got, []int{0, 2, 3, 6}) {
		t.Fatal(got, err)
	}
	if _, err := chooseFlat([]string{"", "feature_unknown"}, p); err == nil {
		t.Fatal("unrecognized targeting")
	}
}
func TestMetadata(t *testing.T) {
	m, err := parseBadging("package: name='org.demo' versionCode='17' versionName='1.2'\nsdkVersion:'23'\napplication-label:'Demo'\napplication-label-zh-CN:'测试'\nnative-code: 'arm64-v8a'\n")
	if err != nil || m.Label != "测试" || m.MinSDK != 23 || m.Code != "17" {
		t.Fatal(m, err)
	}
}
