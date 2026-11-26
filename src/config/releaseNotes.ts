export type ReleaseNoteCategory = "new" | "improved" | "fixed";
export type ReleaseNoteStatus = "released" | "development";

export type ReleaseNoteItem = Readonly<{
  category: ReleaseNoteCategory;
  text: string;
}>;

export type ReleaseNote = Readonly<{
  version: string;
  status: ReleaseNoteStatus;
  /** Real public release date only; omitted for unreleased development versions. */
  releasedOn?: string;
  items: readonly ReleaseNoteItem[];
}>;

export const RELEASE_CATEGORY_LABELS: Readonly<Record<ReleaseNoteCategory, string>> = {
  new: "新增",
  improved: "改进",
  fixed: "修复",
};

export const RELEASE_STATUS_LABELS: Readonly<Record<ReleaseNoteStatus, string>> = {
  released: "已发布",
  development: "开发中",
};

/** Where users download new versions; the about panel links here. */
export const RELEASES_PAGE_URL = "https://github.com/herenfor/selis/releases";

/**
 * User-facing notes for the version this build ships. Only the current
 * version is kept: older versions live on the GitHub releases page. Do not
 * invent release dates for a version that has not been published.
 */
export const RELEASE_NOTES: readonly ReleaseNote[] = [
  {
    version: "0.4.9",
    status: "released",
    releasedOn: "2026-11-26",
    items: [
      {
        category: "improved",
        text: "书籍联网与 JavaScript 执行开关会记住最后一次选择：开启过一次后，之后打开的书默认开启；关闭同样记住，可随时在阅读设置里改回来。",
      },
      {
        category: "fixed",
        text: "调整窗口大小、固定目录或折叠/展开侧栏后，正文会重新排版，不再出现右侧或底部文字被裁切；翻页动画进行中缩放窗口，动画落定后也会补一次重排。",
      },
      {
        category: "fixed",
        text: "开启 JavaScript 执行后，书里的 <noscript> 和 <canvas> 回退内容不再显示；关闭时，<noscript> 里的远程图片仍能正常加载。",
      },
      {
        category: "fixed",
        text: "超宽表格、图片和固定宽度的块不再把正文挤出页面；窄屏配合大字号时不再误分页。",
      },
      {
        category: "fixed",
        text: "书架搜索框和侧边栏目录筛选框只显示一个清除按钮，不再出现两个 X。",
      },
      {
        category: "fixed",
        text: "SVG 图片加载完成后会触发重排，图片尺寸变化不再留下空白或错位。",
      },
    ],
  },
  {
    version: "0.4.8",
    status: "released",
    releasedOn: "2026-11-25",
    items: [
      {
        category: "new",
        text: "翻页动画新增「覆盖」：当前页滑出、下一页露出，带前缘阴影；支持跟手、中途反悔和反向翻页，章边界、双页模式和并排图片章也保持覆盖动画。默认仍是「滑动」，可在 Aa 面板的「翻页动画」里切换。",
      },
      {
        category: "new",
        text: "书架可以直接打开 PDF 文件离线阅读，使用统一阅读页脚翻页；PDF 适配标记为实验性，部分版式或扫描页可能显示异常。",
      },
      {
        category: "new",
        text: "阅读设置新增「书籍联网」和「JavaScript 执行」开关，默认关闭；只对本次开书生效，关书重开复位。",
      },
      {
        category: "improved",
        text: "带本地整页背景的章节（如目录）先解码背景图再显示，不再出现背景比正文晚到。",
      },
      {
        category: "fixed",
        text: "多看画廊章节的多图组按图片逐页分页，双页模式按阅读顺序 1-2 / 3-4 配对，图注、链接和作者固定尺寸的图片不再被误转或裁切。",
      },
      {
        category: "fixed",
        text: "覆盖翻页在章边界、双页模式和并排图片章的首次切换不再退回普通换章或瞬切。",
      },
    ],
  },
  {
    version: "0.4.7",
    status: "released",
    releasedOn: "2026-11-24",
    items: [
      {
        category: "new",
        text: "正文搜索会保留一本书的全部命中，不再只保留前 100 条；关闭搜索面板后结果、当前项和位置都会保留，用同一关键词重新打开不会重新扫描。",
      },
      {
        category: "new",
        text: "阅读页底部新增搜索导航条：显示当前位置和总数，可「上一条 / 下一条 / 返回结果」；跨章命中等落点确认后才前进。",
      },
      {
        category: "improved",
        text: "搜索命中数边扫边增长，结果列表只加载当前可见的十几行，几千条命中也能顺畅滚动；扫描中可以暂停，之后从断点继续，读章失败可重试。",
      },
      {
        category: "improved",
        text: "「搜索原文」合并为一个开关，只在书里存在繁简或自定义文本转换时出现，并移到了搜索面板标题栏。",
      },
      {
        category: "fixed",
        text: "目录、书签和笔记面板恢复细滚动条，长目录可以直接拖动滚动。",
      },
      {
        category: "fixed",
        text: "多看 duokan-image-single 容器内有多张图片时按图逐页分页，双页模式按阅读顺序 1-2 / 3-4 配对，图注和作者固定尺寸的图片不再被误转。",
      },
    ],
  },
  {
    version: "0.4.6",
    status: "released",
    releasedOn: "2026-11-22",
    items: [
      {
        category: "new",
        text: "停靠的目录、书签和笔记面板可以拖动内边缘调宽调窄，方向键、Home/End 和双击也能调整或复位；窄窗口放不下时会自动收起，窗口变宽后自动恢复。",
      },
      {
        category: "new",
        text: "Android 上从文件管理器「其他应用打开」可以直接把 TXT 交给 SeLis 导入，EPUB 也同样支持。",
      },
      {
        category: "improved",
        text: "停靠目录的内边改成与正文贴齐的直角，三个面板不再显示滚动条轨道；打开或收起目录时正文页不再先跳一下。",
      },
      {
        category: "improved",
        text: "弹注优先使用书里的字体和相对字号，Aa 新增「弹注」字体选项，可以单独选择，字号仍跟随正文。",
      },
      {
        category: "fixed",
        text: "带 Ruby 注音的正文现在能正确搜到、跳转并高亮，包括跨注音分段和相邻句子的命中。",
      },
    ],
  },
  {
    version: "0.4.5",
    status: "released",
    releasedOn: "2026-11-19",
    items: [
      {
        category: "new",
        text: "分享书摘可以带上书里的高亮，还能单独给这张图换重点色；和摘录有部分重叠的笔记也能逐条选进图里。",
      },
      {
        category: "improved",
        text: "分享时可以在原文里逐句删补摘录的开头和结尾，高亮和笔记会跟着范围一起更新。",
      },
      {
        category: "fixed",
        text: "带 Ruby 注音的书摘，分享图在横排和竖排都会保留注音，复制文字时只复制正文。",
      },
      {
        category: "fixed",
        text: "快速连续翻页时跨章更顺，经过短彩页章节不再卡顿；修好了快速连翻或整屏滑动偶尔跳回本章首页的问题。",
      },
    ],
  },
  {
    version: "0.4.4",
    status: "released",
    releasedOn: "2026-11-17",
    items: [
      {
        category: "new",
        text: "字体设置可以把「标题」和「正文」分开挑字体了，用独立开关打开；原来的强制覆盖 / 补充缺失两种模式不变。",
      },
      {
        category: "improved",
        text: "双页模式下，带两张图的书名页会和封面正确拼在一起，不再半屏空白。",
      },
      {
        category: "improved",
        text: "拖书建文件夹、拖进文件夹的高亮和放置提示统一了；文件夹导入预览、超长文件夹标题也更整齐。",
      },
      {
        category: "fixed",
        text: "修好了部分 SVG 封面白屏、双页背景图翻页错位、回翻上一章落章首、批量删除后空文件夹残留等问题；缺样式表 / 机排书本的适配仍在继续，这一版还没有 PDF。",
      },
    ],
  },
  {
    version: "0.4.3",
    status: "released",
    releasedOn: "2026-11-16",
    items: [
      {
        category: "fixed",
        text: "修复跨页复制问题（机排书本暂未适配，将在下个版本尝试修复）。",
      },
    ],
  },
  {
    version: "0.4.2",
    status: "released",
    releasedOn: "2026-11-13",
    items: [
      {
        category: "improved",
        text: "项目仓库迁移到 herenfor/selis，应用内检查更新与发行页地址同步切换。",
      },
      {
        category: "new",
        text: "图片查看器支持旋转、同章前后翻图、1:1 切换，以及触屏双击、捏合和拖动。",
      },
      {
        category: "new",
        text: "新增繁体中文界面，可跟随系统或手动切换，重启后保持选择。",
      },
      {
        category: "new",
        text: "书架文件夹与书混排，文件夹使用叠层卡片，进出层保留滚动位置。",
      },
      {
        category: "new",
        text: "笔记连续删除可逐条撤销，并增加「最近删除」回收站。",
      },
      {
        category: "new",
        text: "选中文字菜单新增网页搜索/查词入口。",
      },
      {
        category: "new",
        text: "手机书架列表显示封面和作者，固定目录增加过渡动画。",
      },
      {
        category: "fixed",
        text: "修复图片查看器触屏 1:1 入口、顶栏首次点击、手机语言选项溢出等一批问题。",
      },
    ],
  },
];

function normalizeVersion(version: string): string {
  return version.trim().replace(/^v/i, "");
}

/** Exact version match after allowing an optional leading "v". */
export function findReleaseNote(version: string): ReleaseNote | null {
  const normalized = normalizeVersion(version);
  return RELEASE_NOTES.find((note) => normalizeVersion(note.version) === normalized) ?? null;
}
