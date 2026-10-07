import { useCallback, useState } from "react";
import { useDropzone, type FileRejection } from "react-dropzone";

type Props = {
  label: string;
  hint: string;
  file: File | null;
  onFile: (file: File | null) => void;
  accent: "ours" | "supplier";
};

function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export function FileDropZone({ label, hint, file, onFile, accent }: Props) {
  const [rejectMessage, setRejectMessage] = useState<string | null>(null);

  const onDrop = useCallback(
    (accepted: File[], rejected: FileRejection[]) => {
      setRejectMessage(null);
      if (rejected.length > 0) {
        setRejectMessage("ניתן להעלות קובץ PDF בלבד (עד 15MB).");
        return;
      }
      if (accepted[0]) onFile(accepted[0]);
    },
    [onFile],
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { "application/pdf": [".pdf"] },
    maxFiles: 1,
    maxSize: 15 * 1024 * 1024,
    multiple: false,
  });

  return (
    <section className={`dropzone dropzone--${accent}`}>
      <header className="dropzone__header">
        <h2>{label}</h2>
        <p>{hint}</p>
      </header>

      <div
        {...getRootProps()}
        className={[
          "dropzone__area",
          isDragActive ? "is-active" : "",
          file ? "has-file" : "",
        ]
          .filter(Boolean)
          .join(" ")}
        role="button"
        tabIndex={0}
      >
        <input {...getInputProps()} />
        {file ? (
          <div className="dropzone__file">
            <span className="dropzone__file-icon" aria-hidden>
              PDF
            </span>
            <div>
              <strong title={file.name}>{file.name}</strong>
              <span>{formatBytes(file.size)}</span>
            </div>
          </div>
        ) : (
          <div className="dropzone__empty">
            <span className="dropzone__plus" aria-hidden>
              +
            </span>
            <strong>גררו לכאן קובץ PDF</strong>
            <span>או לחצו לבחירת קובץ</span>
          </div>
        )}
      </div>

      {file && (
        <button
          type="button"
          className="dropzone__clear"
          onClick={() => {
            setRejectMessage(null);
            onFile(null);
          }}
        >
          הסרה
        </button>
      )}

      {rejectMessage && <p className="dropzone__error">{rejectMessage}</p>}
    </section>
  );
}
