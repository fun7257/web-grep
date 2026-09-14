package main

import (
	"flag"
	"fmt"
	"net"
	"os"
	"os/signal"
	"path/filepath"
	"strconv"
	"syscall"
	"time"

	"web-grep/internal/auth"
	"web-grep/internal/config"
	"web-grep/internal/httpapi"
	"web-grep/internal/logx"
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
	svc := search.New(cfg, engine, kind, stats.Open(countPath))
	webDist := ""
	if !cfg.Dev {
		webDist = resolveWebDist(cfg.WebDist)
	}
	srv := &httpapi.Server{
		Cfg:      cfg,
		Search:   svc,
		Engine:   kind,
		WebDist:  webDist,
		Sessions: sessions,
	}
	if s, ok := version.(string); ok {
		srv.Version = s
	}

	logx.Info("listening", map[string]any{
		"host":      cfg.Host,
		"port":      cfg.Port,
		"engine":    kind,
		"rootLabel": cfg.RootLabel,
	})
	logx.Debug("root path", map[string]any{"root": cfg.RootReal})

	errCh := make(chan error, 1)
	go func() { errCh <- httpapi.ListenAndServe(srv) }()
	go func() {
		if err := waitForListen(cfg.Host, cfg.Port, 5*time.Second); err != nil {
			logx.Warn("server did not become ready before persisting token", map[string]any{"err": err.Error()})
			return
		}
		rewrote, err := cfg.SealToken()
		if err != nil {
			logx.Warn("could not persist hashed token; login still uses the in-memory hash", map[string]any{
				"path": cfg.ConfigPath,
				"err":  err.Error(),
			})
			return
		}
		if rewrote {
			logx.Info("hashed token in config.yaml", map[string]any{"path": cfg.ConfigPath})
		}
	}()

	hup := make(chan os.Signal, 1)
	signal.Notify(hup, syscall.SIGHUP)
	go func() {
		for range hup {
			next, err := config.Load(cfg.ConfigPath)
			if err != nil {
				logx.Error("reload failed", map[string]any{"err": err.Error()})
				continue
			}
			svc.AbortAll()
			svc.SetCfg(next)
			srv.Cfg = next
			logx.SetLevel(next.LogLevel)
			logx.Info("reloaded config", map[string]any{"rootLabel": next.RootLabel, "root": next.RootReal})
		}
	}()

	sig := make(chan os.Signal, 1)
	signal.Notify(sig, syscall.SIGINT, syscall.SIGTERM)
	select {
	case <-sig:
		svc.AbortAll()
		return nil
	case err := <-errCh:
		return err
	}
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
