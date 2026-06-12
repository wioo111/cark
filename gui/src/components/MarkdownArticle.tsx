import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'

interface MarkdownArticleProps {
  markdown: string
  paperId: string
}

function resolveMediaUrl(paperId: string, source: string) {
  if (!source || source.startsWith('http://') || source.startsWith('https://') || source.startsWith('data:') || source.startsWith('#')) {
    return source
  }

  const cleaned = source.replace(/^\.?\//, '')
  const relativePath = cleaned.startsWith('images/') ? `auto/${cleaned}` : cleaned
  return `/api/media/${encodeURIComponent(paperId)}?path=${encodeURIComponent(relativePath)}`
}

export function MarkdownArticle({ markdown, paperId }: MarkdownArticleProps) {
  return (
    <article className="cark-doc mx-auto max-w-[860px]">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[[rehypeKatex, { strict: 'ignore' }]]}
        components={{
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
            <figure className="cark-doc-figure" data-locator-node="true">
              <img
                src={resolveMediaUrl(paperId, src ?? '')}
                alt={alt ?? ''}
                loading="lazy"
                className="cark-doc-image"
              />
              {alt ? <figcaption className="cark-doc-caption">{alt}</figcaption> : null}
            </figure>
          ),
        }}
      >
        {markdown}
      </ReactMarkdown>
    </article>
  )
}
