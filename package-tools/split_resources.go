package main

import (
	"regexp"
	"strconv"
	"strings"
)

// base 清单持有资源 ID，语言分包持有中文值；须按 ID 关联，不能猜 app_name。
var appLabelID = regexp.MustCompile(`android:label\(0x01010001\)=@(0x[[:xdigit:]]+)`)

func packageLabelID(tree string) string {
	inApp := false
	for _, line := range strings.Split(tree, "\n") {
		l := strings.TrimSpace(line)
		if strings.HasPrefix(l, "E: ") {
			inApp = strings.HasPrefix(l, "E: application ")
			continue
		}
		if inApp {
			if m := appLabelID.FindStringSubmatch(l); m != nil {
				return m[1]
			}
		}
	}
	return ""
}
func chineseLabel(resources, id string) string {
	inResource := false
	best := ""
	priority := 0
	for _, line := range strings.Split(resources, "\n") {
		l := strings.TrimSpace(line)
		if strings.HasPrefix(l, "resource ") {
			inResource = strings.HasPrefix(l, "resource "+id+" ")
			continue
		}
		if !inResource {
			continue
		}
		config, value, ok := strings.Cut(l, ") ")
		if !ok {
			continue
		}
		rank := 0
		switch config {
		case "(zh-rCN", "(b+zh+Hans+CN":
			rank = 3
		case "(zh", "(b+zh+Hans":
			rank = 2
		case "(zh-rTW", "(zh-rHK":
			rank = 1
		}
		if rank > priority {
			if text, e := strconv.Unquote(value); e == nil && text != "" {
				best = text
				priority = rank
			}
		}
	}
	return best
}
