import { FileUp, LoaderCircle } from 'lucide-react'
import { useRef, useState } from 'react'

interface UploadPanelProps {
  uploading: boolean
  disabled: boolean
  disabledReason?: string | null
  error: string | null
  onUpload: (file: File) => void
}

export function UploadPanel({
  uploading,
  disabled,
  disabledReason,
  error,
  onUpload,
}: UploadPanelProps) {
  const [dragActive, setDragActive] = useState(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  function selectFile(file: File | undefined) {
    if (file && !disabled) {
      onUpload(file)
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
        selectFile(event.dataTransfer.files?.[0])
      }}
      className={[
        'rounded-[30px] border border-dashed px-6 py-7 transition lg:px-8',
        dragActive
          ? 'border-amber-300/60 bg-amber-300/10'
          : 'border-white/12 bg-[radial-gradient(circle_at_top_left,rgba(245,158,11,0.11),transparent_34%),rgba(255,255,255,0.03)]',
      ].join(' ')}
    >
      <div className="flex flex-col items-start justify-between gap-5 md:flex-row md:items-center">
        <div>
          <p className="text-xs uppercase tracking-[0.24em] text-amber-200">开始阅读</p>
          <h2 className="mt-2 font-serif text-2xl text-zinc-50">上传一篇 PDF</h2>
          <p className="mt-2 text-sm leading-7 text-zinc-400">拖到这里，或选择文件。其余步骤自动完成。</p>
        </div>
        <button
          type="button"
          disabled={uploading || disabled}
          onClick={() => fileInputRef.current?.click()}
          className="inline-flex items-center gap-2 rounded-full border border-amber-300/40 bg-amber-300/15 px-5 py-3 text-sm font-medium text-amber-100 transition hover:border-amber-300/70 hover:bg-amber-300/20 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {uploading ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <FileUp className="h-4 w-4" />}
          {uploading ? '正在上传' : disabled ? '暂不可上传' : '选择 PDF'}
        </button>
      </div>
      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf,application/pdf"
        disabled={disabled}
        className="hidden"
        onChange={(event) => selectFile(event.target.files?.[0])}
      />
      {disabledReason ? (
        <p className="mt-4 text-sm text-amber-100/80">{disabledReason}</p>
      ) : null}
      {error ? (
        <div className="mt-4 rounded-[18px] border border-rose-400/20 bg-rose-400/10 px-4 py-3 text-sm text-rose-100">
          {error}
        </div>
      ) : null}
    </section>
  )
}
