package main

import (
	"fmt"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"

	"web-grep/internal/config"
	"web-grep/internal/httpapi"
	"web-grep/internal/logx"
	"web-grep/internal/rg"
	"web-grep/internal/search"
)

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func run() error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}
	logx.SetLevel(cfg.LogLevel)
	if cfg.Token == "" {
		logx.Warn("WEB_GREP_TOKEN is unset; auth is disabled (Host/Origin still apply)", nil)
	}
	if cfg.AllowSecrets {
		logx.Warn("WEB_GREP_ALLOW_SECRETS=true; denylist disabled", nil)
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

	svc := search.New(cfg, engine, kind)
	webDist := ""
	if !cfg.Dev {
		webDist = resolveWebDist(cfg.WebDist)
	}
	srv := &httpapi.Server{
		Cfg:     cfg,
		Search:  svc,
		Engine:  kind,
		WebDist: webDist,
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

	hup := make(chan os.Signal, 1)
	signal.Notify(hup, syscall.SIGHUP)
	go func() {
		for range hup {
			next, err := config.Load()
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
			filepath.Join(dir, "apps/web/dist"),
			filepath.Join(dir, "web/dist"),
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
