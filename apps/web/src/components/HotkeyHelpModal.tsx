import { useLocale } from "../hooks/useLocale.ts";
import { AppModal } from "./AppModal.tsx";

export function HotkeyHelpModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useLocale();

  const shortcuts = [
    { key: "Enter", desc: "提交搜索 / Submit search" },
    { key: "Shift+Enter", desc: "添加过滤 / Add filter" },
    { key: "⌘/Ctrl + Enter", desc: "强制搜索 / Run search" },
    { key: "Alt + C", desc: "切换大小写匹配 / Toggle match case" },
    { key: "Alt + W", desc: "切换全词匹配 / Toggle whole word" },
    { key: "Alt + R", desc: "切换正则表达式 / Toggle regex" },
    { key: "/", desc: "聚焦搜索框 / Focus query box" },
    { key: "j / ↓", desc: "下一个结果 / Next match" },
    { key: "k / ↑", desc: "上一个结果 / Previous match" },
    { key: "Enter (列表)", desc: "跳转至代码预览区 / Jump to preview" },
    { key: "⌘/Ctrl + F", desc: "预览内查找 / Find in preview" },
    { key: "⌘/Ctrl + C", desc: "复制选中文件路径 / Copy selected path" },
    { key: "Escape", desc: "取消搜索 / 退出输入 / 关闭弹窗" },
    { key: "?", desc: "打开本快捷键帮助 / Show this modal" },
  ];

  return (
    <AppModal
      open={open}
      title={t("hotkeysTitle")}
      boxClass="hotkey-modal"
      onClose={onClose}
    >
      <div className="hotkey-list">
        {shortcuts.map((item) => (
          <div key={item.key} className="hotkey-row">
            <kbd className="hotkey-kbd">{item.key}</kbd>
            <span className="hotkey-desc">{item.desc}</span>
          </div>
        ))}
      </div>
    </AppModal>
  );
}
