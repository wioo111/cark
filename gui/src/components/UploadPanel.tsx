import { BookOpen, FileUp, LoaderCircle } from 'lucide-react'
import { useRef, useState } from 'react'

interface UploadPanelProps {
  uploading: boolean
  disabled: boolean
  disabledReason?: string | null
  error: string | null
  onUpload: (files: File[]) => void
  onOpenZotero: () => void
}

export function UploadPanel({
  uploading,
  disabled,
  disabledReason,
  error,
  onUpload,
  onOpenZotero,
}: UploadPanelProps) {
  const [dragActive, setDragActive] = useState(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  function selectFiles(files: FileList | File[] | null | undefined) {
    if (files && files.length > 0 && !disabled) {
      onUpload(Array.from(files))
    }
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  return (
    <section
      onDragOver={(event) => {
        event.preventDefault()
        setDragActive(true)
      }}
      onDragLeave={() => setDragActive(false)}
      onDrop={(event) => {
        event.preventDefault()
        setDragActive(false)
        if (disabled) {
          return
        }
        selectFiles(event.dataTransfer.files)
      }}
      className={[
        'rounded-[30px] border border-dashed px-6 py-7 transition lg:px-8',
        dragActive
          ? 'border-amber-300/60 bg-amber-300/10'
          : 'cark-panel bg-[radial-gradient(circle_at_top_left,rgba(var(--accent-rgb),0.11),transparent_34%),var(--surface-card)]',
      ].join(' ')}
    >
      <div className="flex flex-col items-start justify-between gap-5 md:flex-row md:items-center">
        <div>
          <p className="text-xs uppercase tracking-[0.24em] text-[rgba(var(--accent-rgb),0.9)]">开始阅读</p>
          <h2 className="cark-title mt-2 font-serif text-2xl">上传 PDF</h2>
          <p className="cark-muted mt-2 text-sm leading-7">拖到这里，或一次选择多个文件。其余步骤自动完成。</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            disabled={uploading || disabled}
            onClick={() => fileInputRef.current?.click()}
            className="cark-button-accent inline-flex items-center gap-2 rounded-full px-5 py-3 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-60"
          >
            {uploading ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <FileUp className="h-4 w-4" />}
            {uploading ? '正在上传' : disabled ? '暂不可上传' : '选择 PDF'}
          </button>
          <button
            type="button"
            disabled={uploading || disabled}
            onClick={onOpenZotero}
            aria-haspopup="dialog"
            aria-controls="zotero-import-dialog"
            className="cark-button-secondary inline-flex items-center gap-2 rounded-full px-4 py-3 text-sm disabled:cursor-not-allowed disabled:opacity-50"
          >
            <BookOpen className="h-4 w-4" />
            从 Zotero 导入
          </button>
        </div>
      </div>
      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf,application/pdf"
        multiple
        disabled={disabled}
        className="hidden"
        onChange={(event) => selectFiles(event.target.files)}
      />
      {disabledReason ? (
        <p className="mt-4 text-sm text-[rgba(var(--accent-rgb),0.78)]">{disabledReason}</p>
      ) : null}
      {error ? (
        <div className="mt-4 rounded-[18px] border border-rose-400/20 bg-rose-400/10 px-4 py-3 text-sm text-rose-100">
          {error}
        </div>
      ) : null}
    </section>
  )
}
