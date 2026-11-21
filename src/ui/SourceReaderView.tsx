import { Component, createRef, forwardRef, type ReactNode } from "react";
import { ComicReaderView } from "./ComicReaderView";
import { ReaderView, type ReaderHandle, type ReaderViewProps } from "./ReaderView";
import { notifyDockSizeSettled } from "./pagedReaderResize";
import "./sidebarDockViewport.css";

interface Props {
  dockedSide: "left" | "right" | null;
  /** A pointer drag owns the page size until the drag ends. */
  resizing?: boolean;
  onDockSettled?: () => void;
  children: ReactNode;
}

interface PageSize {
  width: string;
  height: string;
}

/** The book keeps its live layout and scroll anchor while the surrounding
 * space moves. Only the final size reaches the reader's resize observers. */
class SidebarDockViewport extends Component<Props, object, PageSize | null> {
  private page = createRef<HTMLDivElement>();
  private pending: PageSize | null = null;

  getSnapshotBeforeUpdate(previous: Props): PageSize | null {
    const page = this.page.current;
    if (!page) return null;
    if (previous.dockedSide === this.props.dockedSide && previous.resizing === this.props.resizing) return null;
    const style = getComputedStyle(page);
    return { width: style.width, height: style.height };
  }

  componentDidUpdate(previous: Props, _state: object, size: PageSize | null) {
    const page = this.page.current;
    if (!page) return;
    // A drag freezes the page at its starting size; pointer moves only change
    // the surrounding CSS width, so no update reaches the paginator.
    if (this.props.resizing) {
      if (!size) return;
      this.pending = size;
      page.style.width = size.width;
      page.style.height = size.height;
      return;
    }
    if (previous.resizing && !this.props.resizing && previous.dockedSide === this.props.dockedSide) {
      this.pending = null;
      page.style.removeProperty("width");
      page.style.removeProperty("height");
      notifyDockSizeSettled(page);
      this.props.onDockSettled?.();
      return;
    }
    if (!size) return;
    this.pending = size;
    const transitions = page.closest(".main")?.getAnimations?.().filter(animation =>
      "transitionProperty" in animation &&
      (animation.transitionProperty === "margin-left" || animation.transitionProperty === "margin-right" ||
        animation.transitionProperty === "margin-top")
    ) ?? [];
    const release = () => {
      // A reversal owns its own transition, even if an older one just settled.
      if (this.pending !== size) return;
      this.pending = null;
      page.style.removeProperty("width");
      page.style.removeProperty("height");
      notifyDockSizeSettled(page);
      this.props.onDockSettled?.();
    };
    if (!transitions.length) {
      release();
      return;
    }
    page.style.width = size.width;
    page.style.height = size.height;
    void Promise.allSettled(transitions.map(transition => transition.finished)).then(release);
  }

  componentWillUnmount() {
    this.pending = null;
  }

  render() {
    return <div className="sidebar-dock-viewport">
      <div className="sidebar-dock-page" ref={this.page}>{this.props.children}</div>
    </div>;
  }
}

/** Keep the book renderer mounted when its sidebar changes presentation. */
export const SourceReaderView = forwardRef<ReaderHandle,
  ReaderViewProps & Pick<Props, "dockedSide" | "resizing" | "onDockSettled">
>(function SourceReaderView({ dockedSide, resizing = false, onDockSettled, ...props }, ref) {
  const Reader = props.book.sourceFormat === "comic-zip" ? ComicReaderView : ReaderView;
  return <SidebarDockViewport dockedSide={dockedSide} resizing={resizing} onDockSettled={onDockSettled}>
    <Reader ref={ref} {...props} />
  </SidebarDockViewport>;
});
