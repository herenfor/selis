import { SearchPanel } from "./SearchPanel";
import type { ReaderSearchController } from "./useReaderSearchController";

/** Search panel wiring kept out of App; the controller owns every prop. */
export function ReaderSearchPanel({ ui, closing, docked, onClose }: {
  ui: ReaderSearchController;
  closing?: boolean;
  docked?: boolean;
  onClose(): void;
}) {
  return <SearchPanel {...ui.panelProps} closing={closing} docked={docked} onClose={onClose} />;
}
