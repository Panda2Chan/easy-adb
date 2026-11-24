package main

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"os/exec"
	"regexp"
	"strconv"
	"strings"
	"time"
)

type profile struct {
	sdk     int
	abis    []string
	density int
	locale  string
}
type metadata struct {
	Package, Code, Version, Label, Split, Icon string
	MinSDK                                     int
	ABIs                                       []string
	Required                                   bool
}

var attr = regexp.MustCompile(`(?:^| )([A-Za-z]+)='([^']*)'`)
var pkgID = regexp.MustCompile(`^[a-zA-Z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)*$`)

func parseBadging(s string) (metadata, error) {
	var m metadata
	labels := map[string]string{}
	quality := 0
	for _, line := range strings.Split(s, "\n") {
		key, v, ok := strings.Cut(strings.TrimSpace(line), ":")
		if !ok {
			continue
		}
		str := strings.Trim(v, "' ")
		switch {
		case key == "package":
			kv := map[string]string{}
			for _, a := range attr.FindAllStringSubmatch(v, -1) {
				kv[a[1]] = a[2]
			}
			m.Package = kv["name"]
			m.Code = kv["versionCode"]
			m.Version = kv["versionName"]
			m.Split = kv["split"]
		case key == "sdkVersion" || key == "minSdkVersion":
			m.MinSDK, _ = strconv.Atoi(str)
		case key == "application-label" || strings.HasPrefix(key, "application-label-"):
			labels[strings.ToLower(key)] = str
		case strings.HasPrefix(key, "application-icon-"):
			dpi, _ := strconv.Atoi(strings.TrimPrefix(key, "application-icon-"))
			if dpi >= quality && strings.HasSuffix(strings.ToLower(str), ".png") {
				quality = dpi
				m.Icon = str
			}
		case key == "native-code":
			for _, a := range strings.Fields(v) {
				m.ABIs = append(m.ABIs, strings.Trim(a, "'"))
			}
		case key == "uses-split" || key == "required-split-types" || key == "requiredSplitTypes":
			m.Required = true
		}
	}
	for _, k := range []string{"application-label-zh-cn", "application-label-zh-hans", "application-label-zh", "application-label-zh-tw", "application-label"} {
		if labels[k] != "" {
			m.Label = labels[k]
			break
		}
	}
	if !pkgID.MatchString(m.Package) || m.Code == "" {
		return m, errors.New("无法识别 APK 清单的包名或版本")
	}
	return m, nil
}

type limitedBuffer struct {
	content bytes.Buffer
	limit   int
}

func (b *limitedBuffer) Write(p []byte) (int, error) {
	if len(p) > b.limit-b.content.Len() {
		return 0, errors.New("工具输出超限")
	}
	return b.content.Write(p)
}
func command(bin string, args ...string) (string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	c := exec.CommandContext(ctx, bin, args...)
	out := limitedBuffer{limit: 4 << 20}
	diag := limitedBuffer{limit: 4096}
	c.Stdout = &out
	c.Stderr = &diag
	c.WaitDelay = time.Second
	if e := c.Run(); e != nil {
		return "", fmt.Errorf("工具执行失败：%w %s", e, diag.content.String())
	}
	return out.content.String(), nil
}
func device(adb, serial string) profile {
	var p profile
	s, _ := command(adb, "-s", serial, "shell", "getprop")
	props := map[string]string{}
	for _, line := range strings.Split(s, "\n") {
		k, v, ok := strings.Cut(strings.TrimSpace(line), "]: [")
		if ok {
			props[strings.TrimPrefix(k, "[")] = strings.TrimSuffix(v, "]")
		}
	}
	p.sdk, _ = strconv.Atoi(props["ro.build.version.sdk"])
	a := props["ro.product.cpu.abilist"]
	if a == "" {
		a = props["ro.product.cpu.abi"]
	}
	if a != "" {
		p.abis = strings.Split(a, ",")
	}
	p.locale = props["persist.sys.locale"]
	if p.locale == "" {
		p.locale = props["ro.product.locale"]
	}
	density, _ := command(adb, "-s", serial, "shell", "wm", "density")
	for _, l := range strings.Split(density, "\n") {
		if _, v, ok := strings.Cut(l, "density:"); ok {
			p.density, _ = strconv.Atoi(strings.TrimSpace(v))
		}
	}
	return p
}
