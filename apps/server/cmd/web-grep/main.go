package main

import (
	"flag"
	"fmt"
	"net"
	"os"
	"os/signal"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"time"

	"web-grep/internal/auth"
	"web-grep/internal/config"
	"web-grep/internal/httpapi"
	"web-grep/internal/logx"
	"web-grep/internal/ratelimit"
	"web-grep/internal/rg"
	"web-grep/internal/search"
	"web-grep/internal/stats"
)

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func run() error {
	configPath := flag.String("config", "", "path to config.yaml")
	flag.Parse()
	cfg, err := config.Load(*configPath)
	if err != nil {
		return err
	}
	logx.SetLevel(cfg.LogLevel)
	sessions := auth.NewSessions()
	if cfg.AllowSecrets {
		logx.Warn("allow_secrets=true; denylist disabled", nil)
	}

	bin := rg.Detect(cfg.RgPath)
	kind := "none"
	var engine search.Engine
	var version any
	version = nil
	if bin != "" {
		kind = "rg"
		engine = rg.Engine{Bin: bin}
		if v := rg.ProbeVersion(bin); v != "" {
			version = v
		}
	}

	countPath := "search-count"
	if cfg.ConfigPath != "" {
		countPath = filepath.Join(filepath.Dir(cfg.ConfigPath), "search-count")
	}
	counter := stats.Open(countPath)
	svc := search.New(cfg, engine, kind, counter)
	webDist := ""
	if !cfg.Dev {
		webDist = resolveWebDist(cfg.WebDist)
	}
	srv := &httpapi.Server{
		Search:   svc,
		Engine:   kind,
		WebDist:  webDist,
		Sessions: sessions,
		Reads:    ratelimit.New(),
	}
	srv.SetConfig(cfg)
	if s, ok := version.(string); ok {
		srv.Version = s
	}

	logListening(cfg, kind)

	errCh := make(chan error, 1)
	go func() { errCh <- httpapi.ListenAndServe(srv) }()
	go func() {
		if err := waitForListen(cfg.Host, cfg.Port, 5*time.Second); err != nil {
			logx.Warn("server did not become ready before persisting token", map[string]any{"err": err.Error()})
			return
		}
		rewrote, err := cfg.SealToken()
		if err != nil {
			logSealTokenFailed(cfg, err)
			return
		}
		if rewrote {
			logHashedToken(cfg)
		}
	}()

	hup := make(chan os.Signal, 1)
	signal.Notify(hup, syscall.SIGHUP)
	go func() {
		for range hup {
			next, err := config.Load(cfg.ConfigPath)
			if err != nil {
				logReloadFailed(cfg, err)
				continue
			}
			svc.AbortAll()
			// Publish a complete snapshot. Readers (HTTP + search) load
			// atomically and never see mixed old/new fields.
			svc.SetCfg(next)
			srv.SetConfig(next)
			logx.SetLevel(next.LogLevel)
			logReloaded(next)
		}
	}()

	sig := make(chan os.Signal, 1)
	signal.Notify(sig, syscall.SIGINT, syscall.SIGTERM)
	select {
	case <-sig:
		svc.AbortAll()
		counter.Close()
		return nil
	case err := <-errCh:
		svc.AbortAll()
		counter.Close()
		return err
	}
}

func logListening(cfg config.Config, engine string) {
	logx.Info("listening", map[string]any{
		"host":      cfg.Host,
		"port":      cfg.Port,
		"engine":    engine,
		"rootLabel": cfg.RootLabel,
	})
	logx.Debug("root path", map[string]any{"root": cfg.RootReal})
}

// logReloaded matches boot: rootLabel at info, absolute root only at debug.
func logReloaded(next config.Config) {
	logx.Info("reloaded config", map[string]any{"rootLabel": next.RootLabel})
	logx.Debug("root path", map[string]any{"root": next.RootReal})
}

func logHashedToken(cfg config.Config) {
	logx.Info("hashed token in config.yaml", nil)
	logx.Debug("config path", map[string]any{"path": cfg.ConfigPath})
}

func logSealTokenFailed(cfg config.Config, err error) {
	logx.Warn("could not persist hashed token; login still uses the in-memory hash", map[string]any{
		"err": redactPaths(cfg, err.Error()),
	})
	logx.Debug("config path", map[string]any{"path": cfg.ConfigPath, "err": err.Error()})
}

func logReloadFailed(cfg config.Config, err error) {
	logx.Error("reload failed", map[string]any{"err": redactPaths(cfg, err.Error())})
	logx.Debug("reload failed", map[string]any{"err": err.Error()})
}

// redactPaths strips absolute paths from a message logged above debug.
// Known root and config paths are replaced first, longer ones before shorter
// ones, so a config file inside the root is not left as a suffix of the root.
func redactPaths(cfg config.Config, msg string) string {
	type repl struct{ from, to string }
	var reps []repl
	if cfg.ConfigPath != "" {
		reps = append(reps, repl{cfg.ConfigPath, filepath.Base(cfg.ConfigPath)})
	}
	if cfg.RootReal != "" {
		reps = append(reps, repl{cfg.RootReal, cfg.RootLabel})
	}
	if len(reps) == 2 && len(reps[0].from) < len(reps[1].from) {
		reps[0], reps[1] = reps[1], reps[0]
	}
	for _, r := range reps {
		msg = strings.ReplaceAll(msg, r.from, r.to)
	}
	// A failed reload can name a new root this process has not loaded yet.
	return scrubAbs(msg)
}

// scrubAbs replaces any remaining absolute path token with its base name.
func scrubAbs(msg string) string {
	parts := strings.Fields(msg)
	changed := false
	for i, part := range parts {
		core := strings.TrimRight(part, ":,;")
		if core == "" || !filepath.IsAbs(core) {
			continue
		}
		parts[i] = strings.Replace(part, core, filepath.Base(core), 1)
		changed = true
	}
	if !changed {
		return msg
	}
	return strings.Join(parts, " ")
}

func resolveWebDist(override string) string {
	if override != "" {
		if st, err := os.Stat(override); err == nil && st.IsDir() {
			return override
		}
	}
	candidates := []string{"apps/web/dist"}
	if exe, err := os.Executable(); err == nil {
		dir := filepath.Dir(exe)
		candidates = append(candidates,
			filepath.Join(dir, "web"),
			filepath.Join(dir, "web/dist"),
			filepath.Join(dir, "apps/web/dist"),
			filepath.Join(dir, "../apps/web/dist"),
		)
	}
	wd, _ := os.Getwd()
	for _, c := range candidates {
		p := c
		if !filepath.IsAbs(p) && wd != "" {
			p = filepath.Join(wd, c)
		}
		if st, err := os.Stat(p); err == nil && st.IsDir() {
			real, err := filepath.Abs(p)
			if err == nil {
				return real
			}
			return p
		}
	}
	return ""
}

func waitForListen(host string, port int, timeout time.Duration) error {
	dialHost := host
	if dialHost == "0.0.0.0" || dialHost == "::" || dialHost == "" {
		dialHost = "127.0.0.1"
	}
	addr := net.JoinHostPort(dialHost, strconv.Itoa(port))
	deadline := time.Now().Add(timeout)
	var last error
	for time.Now().Before(deadline) {
		conn, err := net.DialTimeout("tcp", addr, 100*time.Millisecond)
		if err == nil {
			_ = conn.Close()
			return nil
		}
		last = err
		time.Sleep(50 * time.Millisecond)
	}
	if last == nil {
		return fmt.Errorf("listen timeout on %s", addr)
	}
	return last
}
