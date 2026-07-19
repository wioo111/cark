import { useEffect, useMemo, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import rehypeRaw from 'rehype-raw'
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'

import {
  isDecorativeExtractedImage,
  rehypeDedupeImages,
  rehypeSectionIds,
  resolveMediaUrl,
} from '@/utils/markdown'

interface MarkdownArticleProps {
  markdown: string
  paperId: string
}

const sanitizeSchema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    code: [
      ...(defaultSchema.attributes?.code ?? []),
      ['className', 'language-math', 'math-inline', 'math-display'],
    ],
  },
}

interface ArticleImageProps {
  paperId: string
  src: string
  alt: string
}

function ArticleImage({ paperId, src, alt }: ArticleImageProps) {
  const [failed, setFailed] = useState(false)
  const [decorative, setDecorative] = useState(false)
  const remoteUrl = resolveMediaUrl(paperId, src)
  const [displayUrl, setDisplayUrl] = useState(remoteUrl)

  useEffect(() => {
    let cancelled = false
    let objectUrl: string | null = null
    setDisplayUrl(remoteUrl)
    if ('caches' in window && remoteUrl && !remoteUrl.startsWith('data:')) {
      window.caches.match(remoteUrl).then(async (cached) => {
        if (!cached || cancelled) return
        objectUrl = URL.createObjectURL(await cached.blob())
        if (!cancelled) setDisplayUrl(objectUrl)
      }).catch(() => undefined)
    }
    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [remoteUrl])

  if (decorative) {
    return null
  }

  if (failed) {
    return (
      <div className="cark-doc-image-error" role="status">
        图片加载失败{alt ? `：${alt}` : ''}
      </div>
    )
  }

  return (
    <figure className="cark-doc-figure" data-locator-node="true">
      <img
        src={displayUrl}
        alt={alt}
        loading="eager"
        decoding="async"
        className="cark-doc-image"
        onLoad={(event) => {
          const image = event.currentTarget
          if (isDecorativeExtractedImage(image.naturalWidth, image.naturalHeight, alt)) {
            setDecorative(true)
          }
        }}
        onError={() => setFailed(true)}
      />
      {alt ? <figcaption className="cark-doc-caption">{alt}</figcaption> : null}
    </figure>
  )
}

export function MarkdownArticle({ markdown, paperId }: MarkdownArticleProps) {
  const components = useMemo(
    () => ({
      h1: ({ node: _node, ...props }) => <h1 data-locator-node="true" className="cark-doc-h1" {...props} />,
      h2: ({ node: _node, ...props }) => <h2 data-locator-node="true" className="cark-doc-h2" {...props} />,
      h3: ({ node: _node, ...props }) => <h3 data-locator-node="true" className="cark-doc-h3" {...props} />,
      h4: ({ node: _node, ...props }) => <h4 data-locator-node="true" className="cark-doc-h4" {...props} />,
      h5: ({ node: _node, ...props }) => <h5 data-locator-node="true" className="cark-doc-h5" {...props} />,
      h6: ({ node: _node, ...props }) => <h6 data-locator-node="true" className="cark-doc-h6" {...props} />,
      p: ({ node: _node, ...props }) => <p data-locator-node="true" className="cark-doc-p" {...props} />,
      ul: ({ node: _node, ...props }) => <ul className="cark-doc-list" {...props} />,
      ol: ({ node: _node, ...props }) => <ol className="cark-doc-list cark-doc-ordered" {...props} />,
      li: ({ node: _node, ...props }) => <li data-locator-node="true" className="cark-doc-li" {...props} />,
      a: ({ node: _node, ...props }) => <a className="cark-doc-link" {...props} />,
      blockquote: ({ node: _node, ...props }) => <blockquote data-locator-node="true" className="cark-doc-quote" {...props} />,
      hr: ({ node: _node, ...props }) => <hr className="cark-doc-hr" {...props} />,
      pre: ({ node: _node, ...props }) => <pre data-locator-node="true" className="cark-doc-pre" {...props} />,
      code: ({ node: _node, className, ...props }) => <code className={['cark-doc-code', className].filter(Boolean).join(' ')} {...props} />,
      table: ({ node: _node, ...props }) => (
        <div className="cark-doc-table-shell" data-locator-node="true">
          <table className="cark-doc-table" {...props} />
        </div>
      ),
      thead: ({ node: _node, ...props }) => <thead className="cark-doc-thead" {...props} />,
      tbody: ({ node: _node, ...props }) => <tbody className="cark-doc-tbody" {...props} />,
      tr: ({ node: _node, ...props }) => <tr className="cark-doc-tr" {...props} />,
      td: ({ node: _node, ...props }) => <td data-locator-node="true" className="cark-doc-td" {...props} />,
      th: ({ node: _node, ...props }) => <th data-locator-node="true" className="cark-doc-th" {...props} />,
      img: ({ node: _node, src, alt }) => (
        <ArticleImage paperId={paperId} src={src ?? ''} alt={alt ?? ''} />
      ),
    }),
    [paperId],
  )

  return (
    <article className="cark-doc mx-auto max-w-[860px]">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[
          rehypeRaw,
          [rehypeSanitize, sanitizeSchema],
          rehypeDedupeImages,
          rehypeSectionIds,
          [rehypeKatex, { strict: 'ignore' }],
        ]}
        components={components}
      >
        {markdown}
      </ReactMarkdown>
    </article>
  )
}
