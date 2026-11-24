package main

import (
	"archive/zip"
	"errors"
	"fmt"
	"io"
	"os"
	"path"
	"strings"
	"unicode"
	"unicode/utf8"
)

const maxFile = 512 << 20
const maxExpanded = 2 << 30

func entries(r *zip.Reader) (map[string]*zip.File, error) {
	if len(r.File) > 30000 {
		return nil, errors.New("ZIP 条目过多")
	}
	result := map[string]*zip.File{}
	seen := map[string]bool{}
	var total uint64
	for _, f := range r.File {
		n := strings.TrimSuffix(f.Name, "/")
		key := strings.ToLower(n)
		if n == "" || len(n) > 1024 || !utf8.ValidString(n) || strings.ContainsAny(n, `\:`) || path.IsAbs(n) || path.Clean(n) != n || n == "." || n == ".." || strings.HasPrefix(n, "../") || strings.IndexFunc(n, unicode.IsControl) >= 0 || seen[key] {
			return nil, errors.New("ZIP 含不安全或重复路径")
		}
		seen[key] = true
		if f.Flags&1 != 0 || (!f.Mode().IsRegular() && !f.Mode().IsDir()) {
			return nil, errors.New("不支持加密包、链接或特殊文件")
		}
		if f.UncompressedSize64 > maxFile || total+f.UncompressedSize64 > maxExpanded {
			return nil, errors.New("ZIP 展开大小超限")
		}
		total += f.UncompressedSize64
		if !f.FileInfo().IsDir() {
			result[n] = f
		}
	}
	return result, nil
}
func readEntry(f *zip.File, limit int64) ([]byte, error) {
	if f == nil || f.UncompressedSize64 > uint64(limit) {
		return nil, errors.New("包内文件缺失或过大")
	}
	s, e := f.Open()
	if e != nil {
		return nil, e
	}
	defer s.Close()
	b, e := io.ReadAll(io.LimitReader(s, limit+1))
	if e == nil && uint64(len(b)) != f.UncompressedSize64 {
		return nil, errors.New("ZIP 长度不符")
	}
	return b, e
}

// 目标名仅由宿主生成，归档路径不会参与磁盘路径拼接。
func copyPrivate(dst string, src io.Reader, limit int64) error {
	out, e := os.OpenFile(dst, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if e != nil {
		return e
	}
	n, e := io.Copy(out, io.LimitReader(src, limit+1))
	closeErr := out.Close()
	if e != nil {
		return e
	}
	if n > limit || n == 0 {
		return fmt.Errorf("文件大小超限或为空")
	}
	return closeErr
}
