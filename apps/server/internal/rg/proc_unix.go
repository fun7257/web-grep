//go:build unix

package rg

import (
	"os/exec"
	"syscall"
	"time"
)

func setProcAttr(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
}

func terminate(cmd *exec.Cmd) {
	if cmd.Process == nil {
		return
	}
	_ = syscall.Kill(-cmd.Process.Pid, syscall.SIGTERM)
	go func() {
		time.Sleep(time.Second)
		_ = syscall.Kill(-cmd.Process.Pid, syscall.SIGKILL)
	}()
}
