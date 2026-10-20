"use client";

import { useCallback, useRef, useState } from "react";
import { UploadCloud } from "lucide-react";

export default function FileDrop({
  accept,
  multiple = false,
  onFiles,
  label,
  hint,
}: {
  accept: string;
  multiple?: boolean;
  onFiles: (files: File[]) => void;
  label: string;
  hint?: string;
}) {
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handle = useCallback(
    (list: FileList | null) => {
      if (!list || list.length === 0) return;
      onFiles([...list]);
    },
    [onFiles]
  );

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => inputRef.current?.click()}
      onKeyDown={(e) => e.key === "Enter" && inputRef.current?.click()}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        handle(e.dataTransfer.files);
      }}
      className={`flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed px-6 py-12 text-center transition ${
        dragging
          ? "border-blue-500 bg-blue-600/10"
          : "border-line bg-panel hover:border-slate-600"
      }`}
    >
      <UploadCloud size={34} className="mb-3 text-blue-400" />
      <p className="text-sm font-semibold text-slate-200">{label}</p>
      {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        multiple={multiple}
        className="hidden"
        onChange={(e) => {
          handle(e.target.files);
          e.target.value = "";
        }}
      />
    </div>
  );
}
