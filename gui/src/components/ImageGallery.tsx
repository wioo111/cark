import { ImageOff } from 'lucide-react'

import type { PaperDetail } from '@/types'

interface ImageGalleryProps {
  detail: PaperDetail
}

export function ImageGallery({ detail }: ImageGalleryProps) {
  if (detail.images.length === 0) {
    return (
      <div className="rounded-[24px] border border-dashed border-white/10 bg-black/20 p-4 text-sm text-zinc-500">
        <div className="mb-2 inline-flex rounded-full border border-white/10 p-2">
          <ImageOff className="h-4 w-4" />
        </div>
        当前任务没有同步出图片资源。
      </div>
    )
  }

  return (
    <div className="grid grid-cols-2 gap-3">
      {detail.images.map((image) => (
        <a
          key={image.filePath}
          href={image.url}
          target="_blank"
          rel="noreferrer"
          className="group overflow-hidden rounded-[22px] border border-white/10 bg-white/[0.03]"
        >
          <div className="aspect-[4/3] overflow-hidden bg-black/30">
            <img
              src={image.url}
              alt={image.name}
              className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.03]"
            />
          </div>
          <div className="px-3 py-3 text-xs text-zinc-400">{image.name}</div>
        </a>
      ))}
    </div>
  )
}
