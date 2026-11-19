import { Component, createRef, forwardRef, type ReactNode } from "react";
import { ComicReaderView } from "./ComicReaderView";
import { ReaderView, type ReaderHandle, type ReaderViewProps } from "./ReaderView";
import { notifyDockSizeSettled } from "./pagedReaderResize";
import "./sidebarDockViewport.css";

interface Props {
  dockedSide: "left" | "right" | null;
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
    if (previous.dockedSide === this.props.dockedSide || !page) return null;
    const style = getComputedStyle(page);
    return { width: style.width, height: style.height };
  }

  componentDidUpdate(_previous: Props, _state: object, size: PageSize | null) {
    const page = this.page.current;
    if (!page || !size) return;
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
export const SourceReaderView = forwardRef<ReaderHandle, ReaderViewProps & Pick<Props, "dockedSide">>(
  function SourceReaderView({ dockedSide, ...props }, ref) {
    const Reader = props.book.sourceFormat === "comic-zip" ? ComicReaderView : ReaderView;
    return <SidebarDockViewport dockedSide={dockedSide}>
      <Reader ref={ref} {...props} />
    </SidebarDockViewport>;
  },
);
