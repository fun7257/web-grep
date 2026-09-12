//go:build windows

package rg

import (
	"os/exec"
	"time"
)

func setProcAttr(cmd *exec.Cmd) {}

func terminate(cmd *exec.Cmd) {
	if cmd.Process == nil {
		return
	}
	_ = cmd.Process.Kill()
	go func() {
		time.Sleep(time.Second)
		_ = cmd.Process.Kill()
	}()
}
