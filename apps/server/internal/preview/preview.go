package preview

import (
	"bufio"
	"bytes"
	"compress/gzip"
	"io"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"unicode/utf8"

	"web-grep/internal/config"
	"web-grep/internal/sandbox"
	"web-grep/internal/utf8cut"
)

const (
	// DefaultCount / MaxCount remain as the config-key defaults (preview_chunk / preview_chunk_max).
	DefaultCount = config.PreviewChunk
	MaxCount     = config.PreviewChunkMax
	sniffBytes   = 8 * 1024
	readBufSize  = 256 * 1024
	indexEvery   = 4096
)

type Query struct {
	Path  string
	From  int
	Count int
	Tail  bool
}

type Line struct {
	N    int    `json:"n"`
	Text string `json:"text"`
}

type Window struct {
	Path      string `json:"path"`
	StartLine int    `json:"startLine"`
	LineCount int    `json:"lineCount"`
	Truncated bool   `json:"truncated"`
	Binary    bool   `json:"binary"`
	Eof       bool   `json:"eof"`
	Lines     []Line `json:"lines"`
}

type Error struct {
	Code    string
	Status  int
	Message string
}

func (e *Error) Error() string { return e.Message }

type idxPt struct {
	line int
	off  int64
}

type fileIndex struct {
	size  int64
	total int
	pts   []idxPt
}

var (
	indexMu sync.Mutex
	indexes = map[string]*fileIndex{}
)

func ReadSlice(cfg config.Config, q Query) (Window, error) {
	from := q.From
	if !q.Tail && from < 1 {
		from = 1
	}
	count := q.Count
	if count <= 0 {
		count = cfg.FilePreviewCount()
	}
	if max := cfg.FilePreviewCountMax(); count > max {
		count = max
	}

	resolved, err := sandbox.ResolveUnderRoot(cfg.RootReal, q.Path)
	if err != nil {
		return Window{}, &Error{Code: "INVALID_PATH", Status: 404, Message: "invalid path"}
	}
	joined, err := sandbox.JoinUnderRoot(cfg.RootReal, q.Path)
	if err != nil {
		return Window{}, &Error{Code: "INVALID_PATH", Status: 404, Message: "invalid path"}
	}
	userRel := sandbox.ToPosixRel(mustRel(cfg.RootReal, joined))
	if sandbox.IsDenied(userRel, cfg.AllowSecrets) || sandbox.IsDenied(resolved.Rel, cfg.AllowSecrets) {
		return Window{}, &Error{Code: "DENIED", Status: 403, Message: "path is denied"}
	}
	st, err := os.Stat(resolved.Abs)
	if err != nil {
		return Window{}, &Error{Code: "INVALID_PATH", Status: 404, Message: "path does not exist"}
	}
	if !st.Mode().IsRegular() {
		return Window{}, &Error{Code: "INVALID_PATH", Status: 400, Message: "not a file"}
	}
	f, err := os.Open(resolved.Abs)
	if err != nil {
		return Window{}, &Error{Code: "INVALID_PATH", Status: 404, Message: "path does not exist"}
	}
	defer f.Close()
	fst, err := f.Stat()
	if err != nil || !fst.Mode().IsRegular() {
		return Window{}, &Error{Code: "INVALID_PATH", Status: 400, Message: "not a file"}
	}
	realAbs, err := filepath.EvalSymlinks(resolved.Abs)
	if err != nil {
		return Window{}, &Error{Code: "INVALID_PATH", Status: 404, Message: "invalid path"}
	}
	realRel := sandbox.ToPosixRel(mustRel(cfg.RootReal, realAbs))
	if escapes(cfg.RootReal, realAbs) {
		return Window{}, &Error{Code: "INVALID_PATH", Status: 404, Message: "path escapes root"}
	}
	if sandbox.IsDenied(realRel, cfg.AllowSecrets) {
		return Window{}, &Error{Code: "DENIED", Status: 403, Message: "path is denied"}
	}

	gz := strings.HasSuffix(strings.ToLower(realAbs), ".gz")
	if !gz {
		head := make([]byte, sniffBytes)
		n, _ := io.ReadFull(f, head)
		head = head[:n]
		if bytes.IndexByte(head, 0) >= 0 {
			return Window{Path: realRel, StartLine: 1, LineCount: 0, Binary: true, Eof: true, Lines: []Line{}}, nil
		}
	}

	src, err := openContent(f, gz)
	if err != nil {
		return Window{}, &Error{Code: "INVALID_PATH", Status: 400, Message: "not a file"}
	}
	if gc, ok := src.(*gzip.Reader); ok {
		defer gc.Close()
	}
	if q.Tail {
		if !gz {
			if total := cachedTotal(realAbs, fst.Size()); total > 0 {
				from = total - count + 1
				if from < 1 {
					from = 1
				}
				win, err := scanWindow(src, realAbs, realRel, fst.Size(), from, count, true)
				if err != nil {
					return Window{}, &Error{Code: "INVALID_PATH", Status: 404, Message: "invalid path"}
				}
				return win, nil
			}
		}
		win, err := scanTail(bufio.NewReaderSize(src, readBufSize), realAbs, realRel, fst.Size(), count, !gz)
		if err != nil {
			return Window{}, &Error{Code: "INVALID_PATH", Status: 404, Message: "invalid path"}
		}
		return win, nil
	}
	win, err := scanWindow(src, realAbs, realRel, fst.Size(), from, count, !gz)
	if err != nil {
		return Window{}, &Error{Code: "INVALID_PATH", Status: 404, Message: "invalid path"}
	}
	return win, nil
}

func openContent(f *os.File, gz bool) (io.Reader, error) {
	if !gz {
		if _, err := f.Seek(0, io.SeekStart); err != nil {
			return nil, err
		}
		return f, nil
	}
	if _, err := f.Seek(0, io.SeekStart); err != nil {
		return nil, err
	}
	return gzip.NewReader(f)
}

func scanWindow(src io.Reader, abs, rel string, size int64, from, count int, seekable bool) (Window, error) {
	startLine, startOff := 1, int64(0)
	if seekable {
		startLine, startOff = bestIndex(abs, size, from)
		if seeker, ok := src.(*os.File); ok && startOff > 0 {
			if _, err := seeker.Seek(startOff, io.SeekStart); err != nil {
				return Window{}, err
			}
		} else {
			startLine, startOff = 1, 0
			if seeker, ok := src.(*os.File); ok {
				if _, err := seeker.Seek(0, io.SeekStart); err != nil {
					return Window{}, err
				}
			}
		}
	}

	br := bufio.NewReaderSize(src, readBufSize)
	lineNo := startLine - 1
	pos := startOff
	for lineNo+1 < from {
		raw, err := readLine(br)
		if len(raw) > 0 {
			lineNo++
			pos += int64(len(raw))
			noteIndex(abs, size, lineNo+1, pos, seekable)
		}
		if err == io.EOF {
			noteTotal(abs, size, lineNo)
			return Window{Path: rel, StartLine: from, LineCount: 0, Eof: true, Lines: []Line{}}, nil
		}
		if err != nil {
			return Window{}, err
		}
	}

	lines := make([]Line, 0, count)
	truncated := false
	for len(lines) < count {
		raw, err := readLine(br)
		if len(raw) > 0 {
			n := len(raw)
			lineNo++
			lines = append(lines, Line{N: lineNo, Text: decodeLine(raw, &truncated)})
			pos += int64(n)
			noteIndex(abs, size, lineNo+1, pos, seekable)
		}
		if err == io.EOF {
			noteTotal(abs, size, lineNo)
			start := from
			if len(lines) > 0 {
				start = lines[0].N
			}
			return Window{Path: rel, StartLine: start, LineCount: len(lines), Truncated: truncated, Eof: true, Lines: lines}, nil
		}
		if err != nil {
			return Window{}, err
		}
	}
	start := from
	if len(lines) > 0 {
		start = lines[0].N
	}
	eof := false
	if t := cachedTotal(abs, size); t > 0 && (len(lines) == 0 || lines[len(lines)-1].N >= t) {
		eof = true
	}
	return Window{Path: rel, StartLine: start, LineCount: len(lines), Truncated: truncated, Eof: eof, Lines: lines}, nil
}

func scanTail(br *bufio.Reader, abs, rel string, size int64, count int, seekable bool) (Window, error) {
	ring := make([]string, count)
	var lineNo int
	pos := int64(0)
	truncated := false
	for {
		raw, err := readLine(br)
		if len(raw) > 0 {
			lineNo++
			pos += int64(len(raw))
			ring[(lineNo-1)%count] = decodeLine(raw, &truncated)
			noteIndex(abs, size, lineNo+1, pos, seekable)
		}
		if err == io.EOF {
			break
		}
		if err != nil {
			return Window{}, err
		}
	}
	noteTotal(abs, size, lineNo)
	if lineNo == 0 {
		return Window{Path: rel, StartLine: 1, LineCount: 0, Eof: true, Lines: []Line{}}, nil
	}
	keep := count
	if keep > lineNo {
		keep = lineNo
	}
	start := lineNo - keep + 1
	lines := make([]Line, 0, keep)
	for i := 0; i < keep; i++ {
		n := start + i
		lines = append(lines, Line{N: n, Text: ring[(n-1)%count]})
	}
	return Window{Path: rel, StartLine: start, LineCount: len(lines), Truncated: truncated, Eof: true, Lines: lines}, nil
}

func decodeLine(raw []byte, truncated *bool) string {
	n := len(raw)
	body := raw
	if n > 0 && body[n-1] == '\n' {
		body = body[:n-1]
		if len(body) > 0 && body[len(body)-1] == '\r' {
			body = body[:len(body)-1]
		}
	}
	text := string(body)
	if len(text) > config.LineTextMaxChars {
		*truncated = true
		return utf8cut.String(text, config.LineTextMaxChars)
	}
	if !utf8.ValidString(text) {
		return strings.ToValidUTF8(text, "\uFFFD")
	}
	return text
}

func readLine(br *bufio.Reader) ([]byte, error) {
	var buf []byte
	for {
		part, err := br.ReadSlice('\n')
		if len(part) > 0 {
			buf = append(buf, part...)
		}
		if err == bufio.ErrBufferFull {
			continue
		}
		return buf, err
	}
}

func bestIndex(abs string, size int64, from int) (line int, off int64) {
	line, off = 1, 0
	indexMu.Lock()
	defer indexMu.Unlock()
	idx, ok := indexes[abs]
	if !ok || idx.size != size {
		return 1, 0
	}
	for _, p := range idx.pts {
		if p.line <= from && p.line >= line {
			line, off = p.line, p.off
		}
	}
	return line, off
}

func noteIndex(abs string, size int64, nextLine int, offset int64, seekable bool) {
	if !seekable || nextLine < 2 || (nextLine-1)%indexEvery != 0 {
		return
	}
	indexMu.Lock()
	idx := indexes[abs]
	if idx == nil || idx.size != size {
		idx = &fileIndex{size: size}
		indexes[abs] = idx
	}
	idx.pts = append(idx.pts, idxPt{line: nextLine, off: offset})
	if len(indexes) > 64 {
		for k := range indexes {
			if k != abs {
				delete(indexes, k)
				break
			}
		}
	}
	indexMu.Unlock()
}

func noteTotal(abs string, size int64, total int) {
	indexMu.Lock()
	idx := indexes[abs]
	if idx == nil || idx.size != size {
		idx = &fileIndex{size: size}
		indexes[abs] = idx
	}
	idx.total = total
	indexMu.Unlock()
}

func cachedTotal(abs string, size int64) int {
	indexMu.Lock()
	defer indexMu.Unlock()
	idx := indexes[abs]
	if idx == nil || idx.size != size {
		return 0
	}
	return idx.total
}

func mustRel(root, abs string) string {
	rel, err := filepath.Rel(root, abs)
	if err != nil {
		return abs
	}
	if rel == "." {
		return ""
	}
	return rel
}

func escapes(root, abs string) bool {
	rel, err := filepath.Rel(root, abs)
	if err != nil {
		return true
	}
	return rel != "." && (rel == ".." || strings.HasPrefix(rel, ".."+string(os.PathSeparator)) || filepath.IsAbs(rel))
}
