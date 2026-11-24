import { newQuickJSWASMModuleFromVariant, newVariant } from "quickjs-emscripten-core";
import quickjs from "@jitl/quickjs-wasmfile-release-sync";
import wasmLocation from "@jitl/quickjs-wasmfile-release-sync/wasm?url";
import { scriptDocumentSource, type ScriptElement } from "./scriptModel";

self.onmessage = async (event: MessageEvent<{ elements: ScriptElement[]; scripts: string[] }>) => {
  try {
    const wasm = await newQuickJSWASMModuleFromVariant(newVariant(quickjs, { wasmLocation }));
    const runtime = wasm.newRuntime();
    try {
      runtime.setMemoryLimit(12 * 1024 * 1024);
      runtime.setMaxStackSize(256 * 1024);
      const deadline = performance.now() + 100;
      runtime.setInterruptHandler(() => performance.now() >= deadline);
      const context = runtime.newContext();
      try {
        const finish = context.unwrapResult(context.evalCode(scriptDocumentSource(event.data.elements)));
        try {
          for (const source of event.data.scripts) context.unwrapResult(context.evalCode(source)).dispose();
          context.unwrapResult(context.callFunction(finish, context.undefined)).consume(result => {
            self.postMessage(context.getString(result));
          });
        } finally { finish.dispose(); }
      } finally { context.dispose(); }
    } finally { runtime.dispose(); }
  } catch { self.postMessage(null); }
};
