package config

import "testing"

func TestLogLevelDefault(t *testing.T) {
	cases := []struct {
		name      string
		yaml      string
		devEnv    string
		levelEnv  string
		wantLevel string
		wantDev   bool
	}{
		{name: "plain", wantLevel: "info"},
		{name: "dev yaml", yaml: "dev: true\n", wantLevel: "debug", wantDev: true},
		{name: "dev env 1", devEnv: "1", wantLevel: "debug", wantDev: true},
		{name: "dev env true", devEnv: "true", wantLevel: "debug", wantDev: true},
		{name: "dev env TRUE", devEnv: "TRUE", wantLevel: "debug", wantDev: true},
		{name: "dev env false", devEnv: "false", wantLevel: "info"},
		{name: "env false overrides yaml dev", yaml: "dev: true\n", devEnv: "false", wantLevel: "info"},
		{name: "explicit yaml info with dev", yaml: "log_level: info\n", devEnv: "1", wantLevel: "info", wantDev: true},
		{name: "explicit yaml warn with dev", yaml: "log_level: warn\n", devEnv: "1", wantLevel: "warn", wantDev: true},
		{name: "explicit yaml debug", yaml: "log_level: debug\n", wantLevel: "debug"},
		{name: "explicit env info with dev", devEnv: "1", levelEnv: "info", wantLevel: "info", wantDev: true},
		{name: "explicit env debug", levelEnv: "debug", wantLevel: "debug"},
		{name: "env overrides yaml", yaml: "log_level: warn\n", devEnv: "1", levelEnv: "error", wantLevel: "error", wantDev: true},
		{name: "blank yaml level", yaml: "log_level: \"  \"\n", wantLevel: "info"},
		{name: "blank yaml level with dev", yaml: "log_level: \"  \"\n", devEnv: "1", wantLevel: "debug", wantDev: true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			path := writeLoadConfig(t, tc.yaml)
			if tc.devEnv != "" {
				t.Setenv(EnvDev, tc.devEnv)
			}
			if tc.levelEnv != "" {
				t.Setenv(EnvLogLevel, tc.levelEnv)
			}
			cfg, err := Load(path)
			if err != nil {
				t.Fatal(err)
			}
			if cfg.LogLevel != tc.wantLevel || cfg.Dev != tc.wantDev {
				t.Fatalf("LogLevel=%s Dev=%v, want %s %v", cfg.LogLevel, cfg.Dev, tc.wantLevel, tc.wantDev)
			}
		})
	}
}
