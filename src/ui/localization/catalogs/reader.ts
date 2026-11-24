import { defineMessages } from "../defineMessages";

export const reader = defineMessages("reader", {
  "reader.toc": "目录",
  "reader.bookmarks": "书签",
  "reader.notes": "笔记",
  "reader.hideSystemStatusBar": "阅读时隐藏系统状态栏",
  "reader.media.audio": "加载并播放音频",
  "reader.media.video": "加载并播放视频",
  "reader.media.loading": "正在加载媒体…",
  "reader.media.retry": "媒体加载失败，点击重试",
  "reader.media.unavailable": "未找到书内媒体文件（暂不支持外部媒体链接）",
  "reader.media.unsupported": "当前设备无法播放此媒体格式",
  "reader.media.play": "点击播放",
  "reader.pdf.experimental": { zh: "PDF 实验性", note: "Small badge in the reader footer for PDF books." },
  "reader.pdf.experimental.hint": { zh: "PDF 阅读为实验性适配，部分版式或扫描页可能显示异常。", note: "Tooltip for the experimental PDF badge; do not promise full compatibility." },
});
